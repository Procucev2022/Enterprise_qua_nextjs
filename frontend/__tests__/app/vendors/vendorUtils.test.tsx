import {
  avatarForName,
  getInitials,
  renderStars,
  maskPublicEmail,
  maskPublicPhone,
  DEFAULT_FILTER,
  MAJOR_CATEGORIES,
  AVATAR_PALETTE,
} from '@/app/vendors/vendorUtils';

describe('vendorUtils', () => {
  describe('avatarForName', () => {
    it('returns a valid palette for various strings', () => {
      const p1 = avatarForName('Acme Corp');
      expect(p1).toBeDefined();
      expect(p1.bg).toContain('from-');
      expect(p1.ring).toContain('ring-');

      const p2 = avatarForName('');
      expect(p2).toBeDefined();

      const p3 = avatarForName('Z');
      expect(p3).toBeDefined();

      // Test multiple different strings to cover palette indices
      const palettes = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map(avatarForName);
      expect(palettes.length).toBe(7);
      expect(AVATAR_PALETTE.length).toBe(6);
    });
  });

  describe('getInitials', () => {
    it('returns fallback for empty or falsy inputs', () => {
      expect(getInitials('')).toBe('??');
      expect(getInitials('   ')).toBe('??');
      expect(getInitials(null as unknown as string)).toBe('??');
      expect(getInitials(undefined as unknown as string)).toBe('??');
    });

    it('returns two letters for single word inputs', () => {
      expect(getInitials('Tata')).toBe('TA');
      expect(getInitials('A')).toBe('A');
      expect(getInitials('Siemens')).toBe('SI');
    });

    it('returns first letters for multiple word inputs', () => {
      expect(getInitials('Tata Steel')).toBe('TS');
      expect(getInitials('Devang Rajyagor')).toBe('DR');
      expect(getInitials('Larsen & Toubro Limited')).toBe('L&');
    });
  });

  describe('renderStars', () => {
    it('handles null, undefined, and zero ratings', () => {
      expect(renderStars(null)).toBeDefined();
      expect(renderStars(undefined)).toBeDefined();
      expect(renderStars(0)).toBeDefined();
    });

    it('handles full and half ratings across 1 to 5', () => {
      expect(renderStars(5)).toBeDefined();
      expect(renderStars(4.5)).toBeDefined();
      expect(renderStars(3.5)).toBeDefined();
      expect(renderStars(2.0)).toBeDefined();
      expect(renderStars(1.0)).toBeDefined();
      expect(renderStars(0.5)).toBeDefined();
    });
  });

  describe('maskPublicEmail', () => {
    it('handles null, undefined, non-string and empty inputs', () => {
      expect(maskPublicEmail(null)).toBe('');
      expect(maskPublicEmail(undefined)).toBe('');
      expect(maskPublicEmail('')).toBe('');
      expect(maskPublicEmail('   ')).toBe('');
      expect(maskPublicEmail(12345 as unknown as string)).toBe('');
      expect(maskPublicEmail({} as unknown as string)).toBe('');
    });

    it('returns already masked emails unchanged', () => {
      expect(maskPublicEmail('sXXXX@gmail.com')).toBe('sXXXX@gmail.com');
      expect(maskPublicEmail('mXXXX@japl.org')).toBe('mXXXX@japl.org');
    });

    it('returns email unchanged if missing @ or @ is first char', () => {
      expect(maskPublicEmail('invalidemail')).toBe('invalidemail');
      expect(maskPublicEmail('@nodomain.com')).toBe('@nodomain.com');
    });

    it('masks standard email usernames correctly', () => {
      expect(maskPublicEmail('devang@example.com')).toBe('dXXXX@example.com');
      expect(maskPublicEmail('mumbai@japl.org')).toBe('mXXXX@japl.org');
      expect(maskPublicEmail('  sales@vendor.in  ')).toBe('sXXXX@vendor.in');
      expect(maskPublicEmail('a@b.com')).toBe('aXXXX@b.com');
    });
  });

  describe('maskPublicPhone', () => {
    it('handles null, undefined, non-string and empty inputs', () => {
      expect(maskPublicPhone(null)).toBe('');
      expect(maskPublicPhone(undefined)).toBe('');
      expect(maskPublicPhone('')).toBe('');
      expect(maskPublicPhone('   ')).toBe('');
      expect(maskPublicPhone(98765 as unknown as string)).toBe('');
      expect(maskPublicPhone([] as unknown as string)).toBe('');
    });

    it('returns already masked phone unchanged', () => {
      expect(maskPublicPhone('9XXXXXXX09')).toBe('9XXXXXXX09');
      expect(maskPublicPhone('+91 9XXXXXXX03')).toBe('+91 9XXXXXXX03');
    });

    it('returns phone with fewer than 4 digits unchanged', () => {
      expect(maskPublicPhone('12')).toBe('12');
      expect(maskPublicPhone('123')).toBe('123');
      expect(maskPublicPhone('abc')).toBe('abc');
    });

    it('handles +91 country prefix', () => {
      expect(maskPublicPhone('+919082848703')).toBe('+91 9XXXXXXX03');
      expect(maskPublicPhone('+91 9876543210')).toBe('+91 9XXXXXXX10');
    });

    it('handles 12-digit numbers starting with 91 without plus', () => {
      expect(maskPublicPhone('919082848703')).toBe('+91 9XXXXXXX03');
      expect(maskPublicPhone('919876543210')).toBe('+91 9XXXXXXX10');
    });

    it('handles international numbers starting with +', () => {
      expect(maskPublicPhone('+1 4155552671')).toBe('+ 4XXXXXXX71');
      expect(maskPublicPhone('+44 2071234567')).toBe('+ 2XXXXXXX67');
    });

    it('handles numbers longer than 10 digits without +', () => {
      expect(maskPublicPhone('0229082848703')).toBe('9XXXXXXX03');
    });

    it('handles standard 10-digit mobile numbers', () => {
      expect(maskPublicPhone('9082848703')).toBe('9XXXXXXX03');
      expect(maskPublicPhone('9876543210')).toBe('9XXXXXXX10');
    });

    it('handles short 4-digit and 5-digit numbers', () => {
      expect(maskPublicPhone('1234')).toBe('1X34');
      expect(maskPublicPhone('12345')).toBe('1XX45');
    });
  });

  describe('constants', () => {
    it('exports DEFAULT_FILTER and MAJOR_CATEGORIES properly', () => {
      expect(DEFAULT_FILTER.page).toBe(1);
      expect(DEFAULT_FILTER.pageSize).toBe(24);
      expect(DEFAULT_FILTER.category).toBe('all');
      expect(DEFAULT_FILTER.state).toBe('all');
      expect(DEFAULT_FILTER.minRating).toBe(0);
      expect(DEFAULT_FILTER.verifiedOnly).toBe(false);

      expect(MAJOR_CATEGORIES.length).toBeGreaterThan(15);
      expect(MAJOR_CATEGORIES).toContain('All Categories');
      expect(MAJOR_CATEGORIES).toContain('Mechanical');
      expect(MAJOR_CATEGORIES).toContain('General Industrial');
    });
  });
});
