import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';

export interface GmailCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
}

export class GmailService {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail | null = null;

  constructor(credentials: GmailCredentials) {
    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string): Promise<GmailTokens> {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens as GmailTokens;
  }

  /**
   * Set tokens and initialize Gmail API
   */
  setTokens(tokens: GmailTokens): void {
    this.oauth2Client.setCredentials(tokens);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Save tokens to file
   */
  saveTokens(tokens: GmailTokens, tokenPath: string): void {
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  }

  /**
   * Load tokens from file
   */
  loadTokens(tokenPath: string): GmailTokens | null {
    try {
      if (fs.existsSync(tokenPath)) {
        const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
        this.setTokens(tokens);
        return tokens;
      }
    } catch (error) {
      console.error('Error loading tokens:', error);
    }
    return null;
  }

  /**
   * Check if service is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.gmail;
  }

  /**
   * Get Gmail API instance
   */
  getGmailApi(): gmail_v1.Gmail {
    if (!this.gmail) {
      throw new Error('Gmail service not authenticated. Please authenticate first.');
    }
    return this.gmail;
  }

  /**
   * Refresh access token if needed
   */
  async refreshTokenIfNeeded(): Promise<void> {
    try {
      await this.oauth2Client.getAccessToken();
    } catch (error) {
      throw new Error('Failed to refresh token. Please re-authenticate.');
    }
  }
}