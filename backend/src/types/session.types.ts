import 'express-session';
import { MicrosoftOAuthSession } from './microsoft.types';

declare module 'express-session' {
  interface SessionData {
    microsoftOAuth?: MicrosoftOAuthSession;
    /**
     * Temporary MSAL cache partition key stored during OneDrive OAuth initiation.
     * Consumed and deleted by the /api/auth/callback/onedrive handler.
     */
    onedriveMsalPartitionKey?: string;
    /**
     * Temporary MSAL cache partition key stored during SharePoint OAuth initiation.
     * Consumed and deleted by the /api/auth/callback/sharepoint handler.
     */
    sharepointMsalPartitionKey?: string;
  }
}
