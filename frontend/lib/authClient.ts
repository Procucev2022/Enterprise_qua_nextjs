import type {
  AuthResponse,
  OtpRequestPayload,
  RegisterPayload,
  UserSession,
} from './types';
import { UI_STRINGS } from './uiStrings';

const TOKEN_KEY = 'procucev_auth_token';
const SESSION_KEY = 'procucev_user_session';

/**
 * Transport for the authentication API.
 *
 * Every credential check is performed by the backend against the shared
 * Procucev identity database. This client deliberately has NO offline fallback:
 * if the API cannot be reached, the caller receives an explicit failure rather
 * than a fabricated session, so an unreachable backend can never be mistaken
 * for a successful sign-in.
 */
class AuthClient {
  private token: string | null = null;
  private currentSession: UserSession | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
      const savedSession = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
      if (savedSession) {
        try {
          this.currentSession = JSON.parse(savedSession) as UserSession;
        } catch {
          this.currentSession = null;
        }
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public getSessionUser(): UserSession | null {
    return this.currentSession;
  }

  public setSession(session: UserSession | null, token?: string | null): void {
    this.currentSession = session;
    this.token = token || null;

    if (typeof window !== 'undefined') {
      if (session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }

      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    }
  }

  /**
   * POST JSON to an auth endpoint, normalising both transport failures and
   * error responses into an AuthResponse carrying a descriptive message.
   */
  private async postJson(path: string, body: unknown): Promise<AuthResponse> {
    let res: Response;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      // Transport-level failure: the API is unreachable. Fail closed.
      return { success: false, error: UI_STRINGS.auth.networkUnreachable };
    }

    let data: AuthResponse | null = null;
    try {
      data = (await res.json()) as AuthResponse;
    } catch {
      data = null;
    }

    if (!data) {
      return { success: false, error: UI_STRINGS.auth.serverErrorFallback };
    }
    if (!res.ok && !data.error) {
      return { ...data, success: false, error: UI_STRINGS.auth.serverErrorFallback };
    }
    return data;
  }

  /**
   * Sign in with email + password, verified against the identity database.
   */
  public async loginWithPassword(email: string, password: string): Promise<AuthResponse> {
    const data = await this.postJson('/api/auth/login', { email, password });
    if (data.success && data.user) {
      data.user.authMethod = 'PASSWORD';
      this.setSession(data.user, data.token);
    }
    return data;
  }

  /**
   * Request a 4-digit email OTP. Only succeeds for an account that exists.
   */
  public async requestOtp(
    email: string,
    roleHint?: OtpRequestPayload['roleHint']
  ): Promise<AuthResponse> {
    return this.postJson('/api/auth/request-otp', { email, roleHint });
  }

  /**
   * Verify a 4-digit OTP and establish a session.
   */
  public async verifyOtp(email: string, code: string): Promise<AuthResponse> {
    const data = await this.postJson('/api/auth/verify-otp', { email, code });
    if (data.success && data.user) {
      data.user.authMethod = 'EMAIL_OTP';
      this.setSession(data.user, data.token);
    }
    return data;
  }

  /**
   * Create a new buyer account in the shared identity database.
   */
  public async register(payload: RegisterPayload): Promise<AuthResponse> {
    const data = await this.postJson('/api/auth/register', payload);
    if (data.success && data.user) {
      data.user.authMethod = 'PASSWORD';
      this.setSession(data.user, data.token);
    }
    return data;
  }

  /**
   * Re-validate the stored token with the server.
   * A token the server rejects is discarded so stale sessions cannot linger.
   */
  public async getSession(): Promise<UserSession | null> {
    if (!this.token) return null;
    try {
      const res = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as AuthResponse;
        if (data.success && data.user) {
          this.currentSession = data.user;
          return data.user;
        }
      }
      if (res.status === 401) {
        this.setSession(null, null);
        return null;
      }
    } catch {
      // Network failure: keep the cached session rather than signing the user
      // out, but do not treat it as re-verified.
      return this.currentSession;
    }
    return this.currentSession;
  }

  /**
   * Sign out, revoking the token server-side and clearing local state.
   */
  public async logout(email?: string): Promise<void> {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ email: email || this.currentSession?.email }),
      });
    } catch {
      // Local state is still cleared below even if the server is unreachable.
    } finally {
      this.setSession(null, null);
    }
  }
}

export const authClient = new AuthClient();
export default authClient;
