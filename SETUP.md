# Email Agent Setup Instructions

This guide will help you set up your personal Gmail management agent using the Claude Agent SDK.

## Prerequisites

- **Node.js** v16 or higher (v18+ recommended)
- **npm** (comes with Node.js)
- A **Gmail account**
- A **Google Cloud Console** account (free)
- An **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com/)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Set Up Environment Variables

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Add your Anthropic API key to the `.env` file:
```
ANTHROPIC_API_KEY=your-api-key-here
```

You can get your API key from [Anthropic Console](https://console.anthropic.com/).

## Step 3: Set Up Gmail API Access

### 3.1 Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API"
   - Click on it and press "Enable"

### 3.2 Create OAuth 2.0 Credentials

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "OAuth client ID"
3. Configure the OAuth consent screen if prompted:
   - Choose "External" user type
   - Fill in the required fields (App name, User support email, Developer contact)
   - Add your Gmail address to "Test users" during development
4. For Application type, choose "Desktop application"
5. Give it a name (e.g., "Email Agent")
6. Click "Create"

### 3.3 Download Credentials

1. Click the download icon next to your newly created OAuth client
2. Save the JSON file as `gmail-credentials.json` in your project root directory
3. **Important**: Add `gmail-credentials.json` to your `.gitignore` file to keep it secure

## Step 4: Run the Agent

**For development (recommended):**

```bash
npm run dev
```

This runs the agent with auto-reload during development using `tsx`.

**For production (optional):**
```bash
npm run build  # Compile TypeScript to JavaScript
npm start      # Run compiled version
```

Note: Most users should use `npm run dev` for the best development experience.

## Step 5: First-Time Authentication

When you first run the agent, it will guide you through the authentication process:

1. The agent will provide a URL for OAuth authentication
2. Open the URL in your browser
3. Sign in to your Gmail account
4. Grant the necessary permissions
5. Copy the authorization code from the browser
6. Paste it into the agent when prompted

The agent will save your authentication tokens for future use.

## Security Notes

- Never commit `gmail-credentials.json` or `gmail-tokens.json` to version control
- Keep your Anthropic API key secure
- The OAuth tokens are stored locally and will be refreshed automatically
- You can revoke access anytime from your [Google Account settings](https://myaccount.google.com/permissions)

## Troubleshooting

### "Invalid client" error
- Make sure your `gmail-credentials.json` file is in the project root
- Verify the file format is correct JSON from Google Cloud Console

### "Access denied" error
- Check that the Gmail API is enabled in your Google Cloud project
- Ensure your OAuth consent screen is properly configured
- Make sure you're using the correct Google account

### "Quota exceeded" error
- Gmail API has daily quota limits
- For personal use, the default quota should be sufficient
- If you need higher limits, you can request a quota increase in Google Cloud Console

### Authentication expired
- Delete `gmail-tokens.json` and re-authenticate
- The agent will guide you through the process again

## Verify Your Setup

After first run, you should see:
```
✓ Gmail authenticated successfully
✓ Agent initialized
```

Your project directory should now contain:
- `gmail-tokens.json` - Your OAuth tokens (auto-generated)
- `memories/` - Directory for persistent memory storage (auto-created)

## Next Steps

Once setup is complete, check out the [USAGE.md](./USAGE.md) file for instructions on how to use your email agent.

## Development Commands

### Quick Reference
```bash
npm run dev     # Run in development mode (recommended)
npm run build   # Compile TypeScript to JavaScript
npm start       # Run compiled production version
```

### When to Use Each Command
- **`npm run dev`**: Daily usage, development, testing new features
- **`npm run build`**: Only needed before deploying or running production build
- **`npm start`**: Run the compiled version (requires `npm run build` first)