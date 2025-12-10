import 'express-session';
import { MicrosoftOAuthSession } from './microsoft.types';

declare module 'express-session' {
  interface SessionData {
    microsoftOAuth?: MicrosoftOAuthSession;
  }
}
