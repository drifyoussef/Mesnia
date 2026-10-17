import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const TOKEN_KEY = 'mesnia_auth_token';
/** Key used before the app was renamed: read once, then moved */
const LEGACY_TOKEN_KEY = 'wevy_auth_token';

/**
 * Keeps the session token. On a phone it lives in the Keychain (iOS) / Keystore (Android),
 * encrypted by the system, instead of the WebView's localStorage. In a browser, localStorage
 * is all there is. The token is also kept in memory so requests can read it synchronously.
 */
@Injectable({
  providedIn: 'root'
})
export class TokenStorageService {
  private current: string | null = null;
  private readonly native = Capacitor.isNativePlatform();

  get token(): string | null {
    return this.current;
  }

  /** Reads the stored token (once, at startup). */
  async load(): Promise<string | null> {
    this.current = await this.read(TOKEN_KEY);
    if (!this.current) {
      const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
      if (legacy) {
        await this.save(legacy);
        localStorage.removeItem(LEGACY_TOKEN_KEY);
      }
    }
    return this.current;
  }

  async save(token: string): Promise<void> {
    this.current = token;
    try {
      if (this.native) await SecureStoragePlugin.set({ key: TOKEN_KEY, value: token });
      else localStorage.setItem(TOKEN_KEY, token);
    } catch (error) {
      // The session still works for this run; it just won't survive a restart
      console.error('Could not store the session token:', error);
    }
  }

  async clear(): Promise<void> {
    this.current = null;
    try {
      if (this.native) await SecureStoragePlugin.remove({ key: TOKEN_KEY });
    } catch {
      // Nothing stored: nothing to remove
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }

  private async read(key: string): Promise<string | null> {
    try {
      if (this.native) return (await SecureStoragePlugin.get({ key })).value || null;
      return localStorage.getItem(key);
    } catch {
      return null; // the plugin throws when the key does not exist
    }
  }
}
