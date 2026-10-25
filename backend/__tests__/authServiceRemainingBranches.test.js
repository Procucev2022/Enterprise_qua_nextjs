const authService = require('../src/services/authService');
const identityQueries = require('../src/db/identityQueries');
const authSessionQueries = require('../src/db/authSessionQueries');
const buyerProfileQueries = require('../src/db/buyerProfileQueries');
const storeService = require('../src/services/storeService');
const pool = require('../src/db/pool');
const { AUTH_MESSAGES } = require('../src/config/constants');

describe('authService remaining branch tests', () => {
  beforeEach(() => {
    jest.spyOn(pool, 'hasStorage').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('changePassword branches', () => {
    test('throws INVALID when submitted OTP code is incorrect', async () => {
      const user = {
        id: 'user-cp-1',
        email: 'buyer.cp1@example.com',
        mobile: '9876543210',
        password: 'OldPassword123!',
        isActive: true,
        role: 'buyer',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(user);
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValue({
        code: '123456',
        expiresAt: Date.now() + 60000,
        attempts: 0,
      });
      const incrementSpy = jest.spyOn(authSessionQueries, 'incrementOtpAttempts').mockResolvedValue(1);

      await expect(
        authService.changePassword({
          email: 'buyer.cp1@example.com',
          code: '999999', // wrong OTP
          newPassword: 'NewPassword123!',
          ipAddress: '127.0.0.1',
        })
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_VERIFICATION_INVALID);

      expect(incrementSpy).toHaveBeenCalled();
    });

    test('throws INVALID when resetToken is revoked', async () => {
      const user = {
        id: 'user-cp-2',
        email: 'buyer.cp2@example.com',
        mobile: '9876543210',
        password: 'OldPassword123!',
        isActive: true,
        role: 'buyer',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(user);
      const token = authService.generateSessionToken(user);
      jest.spyOn(authSessionQueries, 'isTokenRevoked').mockResolvedValue(true);

      await expect(
        authService.changePassword({
          email: 'buyer.cp2@example.com',
          resetToken: token,
          newPassword: 'NewPassword123!',
          ipAddress: '127.0.0.1',
        })
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_VERIFICATION_INVALID);
    });

    test('throws FIELDS_REQUIRED when neither code, resetToken, nor currentPassword is provided', async () => {
      const user = {
        id: 'user-cp-3',
        email: 'buyer.cp3@example.com',
        mobile: '9876543210',
        password: 'OldPassword123!',
        isActive: true,
        role: 'buyer',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(user);

      await expect(
        authService.changePassword({
          email: 'buyer.cp3@example.com',
          newPassword: 'NewPassword123!',
          ipAddress: '127.0.0.1',
        })
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_FIELDS_REQUIRED);
    });
  });

  describe('verifyOtp phone formatting fallback', () => {
    test('finds stored OTP by clean national digits when submitted mobile has country formatting', async () => {
      const user = {
        id: 'user-otp-fmt',
        email: 'fmt@example.com',
        mobile: '9876543210',
        status: 'active',
        isActive: true,
        role: 'buyer',
        isApproved: true,
      };
      jest.spyOn(identityQueries, 'findUserByEmailAndPhone').mockResolvedValue(user);

      // findOtp returns null for full formatted string and channel string, but succeeds for cleanDigits
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce(null) // '+91 98765 43210'
        .mockResolvedValueOnce(null) // '+91 98765 43210_email'
        .mockResolvedValueOnce({
          code: '654321',
          expiresAt: Date.now() + 60000,
          attempts: 0,
        });

      jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue({});

      const res = await authService.verifyOtp('fmt@example.com', '654321', '127.0.0.1', '+91 98765 43210');
      expect(res.user.email).toBe('fmt@example.com');
    });
  });

  describe('registerUser vendor & error sync branches', () => {
    test('creates new vendor in storeService when vendor self-registers and does not exist yet', async () => {
      const payload = {
        email: 'newvendor@supplier.com',
        mobile: '9876543210',
        password: 'VendorPassword123!',
        name: 'Vendor Contact',
        orgName: 'Acme Supplies Ltd',
        role: 'vendor',
        gstin: '27AAAAA0000A1Z5',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      };

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'new-vend-uuid',
          email: 'newvendor@supplier.com',
          name: 'Vendor Contact',
          role: 'vendor',
          status: 'active',
        },
      });
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue(null);
      const addVendorSpy = jest.spyOn(storeService, 'addVendor').mockReturnValue({ id: 'v-new-1', name: 'Acme Supplies Ltd' });
      const confirmSpy = jest.spyOn(storeService, 'confirmVendorPersisted').mockResolvedValue({});

      const res = await authService.registerUser(payload, '127.0.0.1');
      expect(res.user.email).toBe('newvendor@supplier.com');
      expect(addVendorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme Supplies Ltd',
          gstin: '27AAAAA0000A1Z5',
          city: 'Mumbai',
        }),
        'newvendor@supplier.com'
      );
      expect(confirmSpy).toHaveBeenCalled();
    });

    test('updates existing vendor in storeService when vendor already exists during registration', async () => {
      const payload = {
        email: 'existing.vendor@supplier.com',
        mobile: '9876543210',
        password: 'VendorPassword123!',
        name: 'Updated Name',
        orgName: 'Updated Org',
        role: 'vendor',
        gstin: '27BBBBB1111B2Z6',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      };

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertVendorAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'vend-uuid-exist',
          email: 'existing.vendor@supplier.com',
          role: 'vendor',
          status: 'active',
        },
      });
      jest.spyOn(storeService, 'getVendorByIdWithDBFallback').mockResolvedValue({ id: 'v-exist-1', name: 'Old Org' });
      const updateVendorSpy = jest.spyOn(storeService, 'updateVendor').mockReturnValue({});

      const res = await authService.registerUser(payload, '127.0.0.1');
      expect(res.user.email).toBe('existing.vendor@supplier.com');
      expect(updateVendorSpy).toHaveBeenCalledWith('v-exist-1', expect.objectContaining({
        city: 'Pune',
        name: 'Updated Org',
      }));
    });

    test('logs warning when storeService.addBuyerAccount throws during buyer registration', async () => {
      const payload = {
        email: 'buyer.fail.sync@example.com',
        mobile: '9876543210',
        password: 'BuyerPassword123!',
        name: 'Buyer Name',
        role: 'buyer',
      };

      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);
      jest.spyOn(identityQueries, 'insertBuyerAccount').mockResolvedValue({
        created: true,
        user: {
          id: 'buyer-uuid-fail',
          email: 'buyer.fail.sync@example.com',
          role: 'buyer',
          status: 'active',
        },
      });
      jest.spyOn(storeService, 'getBuyerAccountByEmail').mockResolvedValue(null);
      jest.spyOn(storeService, 'addBuyerAccount').mockImplementation(() => {
        throw new Error('Memory store corruption');
      });

      const res = await authService.registerUser(payload, '127.0.0.1');
      expect(res.user.email).toBe('buyer.fail.sync@example.com');
    });
  });

  describe('completeBuyerOnboarding validation & execution', () => {
    test('rejects non-buyer user role', async () => {
      await expect(
        authService.completeBuyerOnboarding({ role: 'vendor', email: 'v@test.com' }, {}, '127.0.0.1')
      ).rejects.toThrow('Only buyer accounts can complete buyer onboarding.');
    });

    test('rejects placeholder phone number 9999999999', async () => {
      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer@test.com' },
          { mobile: '9999999999' },
          '127.0.0.1'
        )
      ).rejects.toThrow('Placeholder phone number 9999999999 must be replaced with your actual phone number.');
    });

    test('rejects when dbUser is not found in database', async () => {
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(null);

      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'missing@test.com' },
          { mobile: '9876543210' },
          '127.0.0.1'
        )
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_ACCOUNT_MISSING);
    });

    test('rejects when current password is incorrect', async () => {
      const dbUser = {
        id: 'u-ob-1',
        email: 'buyer.ob1@test.com',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);

      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob1@test.com' },
          { mobile: '9876543210', currentPassword: 'WrongPassword!' },
          '127.0.0.1'
        )
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_CURRENT_INCORRECT);
    });

    test('rejects when new password is too short or unchanged', async () => {
      const dbUser = {
        id: 'u-ob-2',
        email: 'buyer.ob2@test.com',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);

      // Too short
      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob2@test.com' },
          { mobile: '9876543210', currentPassword: 'CorrectOldPass!', newPassword: 'short' },
          '127.0.0.1'
        )
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_TOO_SHORT);

      // Unchanged
      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob2@test.com' },
          { mobile: '9876543210', currentPassword: 'CorrectOldPass!', newPassword: 'CorrectOldPass!' },
          '127.0.0.1'
        )
      ).rejects.toThrow(AUTH_MESSAGES.CHANGE_PASSWORD_UNCHANGED);
    });

    test('rejects when email OTP is expired or invalid', async () => {
      const dbUser = {
        id: 'u-ob-3',
        email: 'buyer.ob3@test.com',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);

      // Expired email OTP
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValueOnce({
        code: '111222',
        expiresAt: Date.now() - 5000,
      });
      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob3@test.com' },
          {
            mobile: '9876543210',
            currentPassword: 'CorrectOldPass!',
            newPassword: 'BrandNewSecurePass1!',
            emailOtp: '111222',
          },
          '127.0.0.1'
        )
      ).rejects.toThrow('Email verification OTP has expired. Please request a new code.');

      // Invalid email OTP
      jest.spyOn(authSessionQueries, 'findOtp').mockResolvedValueOnce({
        code: '111222',
        expiresAt: Date.now() + 60000,
      });
      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob3@test.com' },
          {
            mobile: '9876543210',
            currentPassword: 'CorrectOldPass!',
            newPassword: 'BrandNewSecurePass1!',
            emailOtp: '999999', // wrong OTP
          },
          '127.0.0.1'
        )
      ).rejects.toThrow('Invalid email verification OTP.');
    });

    test('rejects when mobile OTP is expired or invalid', async () => {
      const dbUser = {
        id: 'u-ob-4',
        email: 'buyer.ob4@test.com',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);

      // Valid email OTP, but expired mobile OTP
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce({ code: '111222', expiresAt: Date.now() + 60000 }) // email
        .mockResolvedValueOnce({ code: '333444', expiresAt: Date.now() - 5000 }); // mobile expired

      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob4@test.com' },
          {
            mobile: '9876543210',
            currentPassword: 'CorrectOldPass!',
            newPassword: 'BrandNewSecurePass1!',
            emailOtp: '111222',
            mobileOtp: '333444',
          },
          '127.0.0.1'
        )
      ).rejects.toThrow('Mobile verification OTP has expired. Please request a new code.');

      // Valid email OTP, but invalid mobile OTP
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce({ code: '111222', expiresAt: Date.now() + 60000 }) // email
        .mockResolvedValueOnce({ code: '333444', expiresAt: Date.now() + 60000 }); // mobile valid stored

      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob4@test.com' },
          {
            mobile: '9876543210',
            currentPassword: 'CorrectOldPass!',
            newPassword: 'BrandNewSecurePass1!',
            emailOtp: '111222',
            mobileOtp: '000000', // wrong mobile OTP
          },
          '127.0.0.1'
        )
      ).rejects.toThrow('Invalid mobile SMS verification OTP.');
    });

    test('rejects when updateBuyerOnboardingStatus returns false', async () => {
      const dbUser = {
        id: 'u-ob-5',
        email: 'buyer.ob5@test.com',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce({ code: '111222', expiresAt: Date.now() + 60000 })
        .mockResolvedValueOnce({ code: '333444', expiresAt: Date.now() + 60000 });
      jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue({});
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(false);

      await expect(
        authService.completeBuyerOnboarding(
          { role: 'buyer', email: 'buyer.ob5@test.com' },
          {
            mobile: '9876543210',
            currentPassword: 'CorrectOldPass!',
            newPassword: 'BrandNewSecurePass1!',
            emailOtp: '111222',
            mobileOtp: '333444',
          },
          '127.0.0.1'
        )
      ).rejects.toThrow('Failed to update buyer onboarding credentials in identity database.');
    });

    test('completes onboarding successfully, updates profile, dispatches pending quotes', async () => {
      const dbUser = {
        id: 'u-ob-success',
        email: 'buyer.success@test.com',
        name: 'Initial Buyer',
        orgId: 'org-profile-10',
        orgName: 'Initial Corp',
        role: 'buyer',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce({ code: '111222', expiresAt: Date.now() + 60000 })
        .mockResolvedValueOnce({ code: '333444', expiresAt: Date.now() + 60000 });
      jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue({});
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(true);
      const updateBuyerSpy = jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({ id: 'buyer-1' });
      const updateProfileSpy = jest.spyOn(buyerProfileQueries, 'updateProfile').mockResolvedValue({});
      const dispatchQuotesSpy = jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockResolvedValue([{ id: 'q-1' }]);
      jest.spyOn(storeService, 'addAuditLog').mockReturnValue({});

      const payload = {
        mobile: '9876543210',
        currentPassword: 'CorrectOldPass!',
        newPassword: 'BrandNewSecurePass1!',
        emailOtp: '111222',
        mobileOtp: '333444',
        companyName: 'Final Enterprise Corp',
        contactName: 'Final Contact Name',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        address: '100 Tech Park',
        gstin: '29ABCDE1234F1Z5',
      };

      const result = await authService.completeBuyerOnboarding(
        { role: 'buyer', email: 'buyer.success@test.com' },
        payload,
        '192.168.1.1'
      );

      expect(result.success).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.dispatchedQuotesCount).toBe(1);
      expect(updateBuyerSpy).toHaveBeenCalledWith('buyer.success@test.com', expect.objectContaining({
        companyName: 'Final Enterprise Corp',
        gstin: '29ABCDE1234F1Z5',
        phone: '9876543210',
      }));
      expect(updateProfileSpy).toHaveBeenCalledWith(
        'org-profile-10',
        expect.objectContaining({
          companyName: 'Final Enterprise Corp',
        }),
        'buyer.success@test.com',
        'u-ob-success'
      );
      expect(dispatchQuotesSpy).toHaveBeenCalledWith('buyer.success@test.com');
    });

    test('handles errors in buyerProfileQueries.updateProfile and storeService.dispatchPendingQuoteNotifications gracefully', async () => {
      const dbUser = {
        id: 'u-ob-warnings',
        email: 'buyer.warn@test.com',
        orgId: 'org-profile-warn',
        role: 'buyer',
        password: 'CorrectOldPass!',
      };
      jest.spyOn(identityQueries, 'findUserByEmail').mockResolvedValue(dbUser);
      jest.spyOn(authSessionQueries, 'findOtp')
        .mockResolvedValueOnce({ code: '111222', expiresAt: Date.now() + 60000 })
        .mockResolvedValueOnce({ code: '333444', expiresAt: Date.now() + 60000 });
      jest.spyOn(authSessionQueries, 'deleteOtp').mockResolvedValue({});
      jest.spyOn(identityQueries, 'updateBuyerOnboardingStatus').mockResolvedValue(true);
      jest.spyOn(storeService, 'updateBuyerAccount').mockReturnValue({ id: 'buyer-warn' });
      // updateProfile throws
      jest.spyOn(buyerProfileQueries, 'updateProfile').mockRejectedValue(new Error('Profile update failure'));
      // dispatchPendingQuoteNotifications throws
      jest.spyOn(storeService, 'dispatchPendingQuoteNotifications').mockRejectedValue(new Error('Quote dispatch error'));
      jest.spyOn(storeService, 'addAuditLog').mockReturnValue({});

      const result = await authService.completeBuyerOnboarding(
        { role: 'buyer', email: 'buyer.warn@test.com' },
        {
          mobile: '9876543210',
          currentPassword: 'CorrectOldPass!',
          newPassword: 'BrandNewSecurePass1!',
          emailOtp: '111222',
          mobileOtp: '333444',
        },
        '127.0.0.1'
      );

      expect(result.success).toBe(true);
      expect(result.dispatchedQuotesCount).toBe(0);
    });
  });
});
