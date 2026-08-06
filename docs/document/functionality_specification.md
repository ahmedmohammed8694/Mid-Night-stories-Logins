# Functionality Specification

> **Target Project:** Midnight Stories (`midnight-stories`)  
> **Primary Audience:** Developers, clients  
> **Document Status:** Complete

---

## 1. Automated Content Moderation & Crisis Warning Pipeline

The platform runs active filtration mechanisms inside `src/moderation.js`:
* **PII Redaction / Scanner:** Scans input values with regex to detect typical identifiers (emails, SSNs, credit card formats, phone numbers) and alerts the client.
* **Toxicity Filter:** Checks strings against a customizable banned toxicity words list before database writes.
* **Crisis Scanner:** Monitors stories for mental health distress or crisis indicators (self-harm, suicidal ideation keywords). Triggering words launch a pop-up modal redirecting the user to crisis lines before allowing submission.
* **Photo Sanitization:** Strips image EXIF geolocation and metadata profiles. Verifies magic bytes to validate file signatures (PNG/JPG/WEBP/PDF) and block executable script injection.

---

## 2. Token-Based Anonymous Management

Anonymous authors are assigned a secure UUID token (`submitter_token`) on submission. This token serves as a lightweight auth credential, letting the user modify or delete their post directly without registering an account.

---

## 3. E-Reader Settings

The book reader client (`reader.js`) saves reader display profiles (font sizes from 12px to 28px, night/sepia/light modes, current chapter progress CFI) to local storage. This preserves the reader's state across browser sessions.

---

## 4. Complete Serverless API Specification (`/api/*`)

 Dynamic endpoints are parsed in Hono inside `src/worker.js`:

### 4.1 Authentication & Session
* `POST /api/auth/signup` - Register a new account.
* `POST /api/auth/login` - Authenticate standard credentials; issues JWT token.
* `GET /api/auth/me` - Validates session and returns current user payload.
* `GET /api/auth/google` - Redirects to Google OAuth 2.0 authorization sequence.
* `GET /api/auth/google/callback` - Verifies Google OAuth parameters and returns JWT token.
* `POST /api/auth/forgot-password` - Requests 2FA recovery OTP.
* `POST /api/auth/verify-otp` - Verifies password reset OTP.
* `POST /api/auth/reset-password` - Resets password with verified OTP.

### 4.2 Stories Discovery & Engagement
* `GET /api/stories` - Lists public stories with category/tag filters.
* `POST /api/stories` - Submits a story; scans content for toxicity and PII.
* `GET /api/stories/:id` - Fetches single story content.
* `POST /api/stories/:id/like` - Toggles like counter for story.
* `POST /api/stories/:id/comments` - Submits comment; checks moderation.
* `DELETE /api/comments/:id` - Allows comments removal by author or admin.

### 4.3 Digital Books & Reader
* `GET /api/books` - Lists approved books with search and genre pills.
* `GET /api/books/:id` - Fetches metadata for individual book.
* `GET /api/books/:id/file` - Downloads binary ePUB/PDF book payload.
* `POST /api/books/:id/progress` - Updates user percent progress and position CFI.

### 4.4 Messaging & User Interactions
* `GET /api/conversations` - Lists user active message rooms.
* `POST /api/conversations` - Starts a messaging channel.
* `POST /api/conversations/:id/accept` - Accepts messaging request.
* `POST /api/conversations/:id/decline` - Rejects messaging request.
* `GET /api/conversations/:id/messages` - Returns messages within conversation.
* `POST /api/messages` - Sends a direct message.
* `DELETE /api/conversations/:id` - Closes chat channel.
* `GET /api/users/search` - Searches user directory.
* `GET /api/users/:idOrUserId` - Returns user profile.
* `PUT /api/users/me` - Updates user profile details.
* `POST /api/users/me/upload` - Saves profile image to R2 bucket.
* `POST /api/users/:id/follow` - Follows user profile.
* `POST /api/users/:id/block` - Blocks user profile.
* `POST /api/users/:id/unblock` - Unblocks user profile.
* `GET /api/users/me/blocked` - Returns list of blocked users.

### 4.5 Helpdesk Ticketing & Support
* `GET /api/user/ticket-categories` - Returns ticket category descriptors.
* `POST /api/user/tickets/create` - Submits a help ticket; uploads attachments to R2.
* `GET /api/users/me/support-inbox` - Fetches user ticket messaging updates.
* `GET /api/crisis-resources` - Returns local emergency services listing.

### 4.6 System Administration & RBAC
* `POST /api/admin/login` - Authenticates admin portal credentials.
* `GET /api/admin/stats` - Returns dashboard data.
* `GET /api/admin/queue` - Lists pending stories/comments moderation pipeline.
* `POST /api/admin/stories` - Admin story moderation command (Approve/Reject).
* `PUT /api/admin/stories/:id` - Edits story content in database.
* `DELETE /api/admin/stories/:id` - Deletes story completely.
* `PUT /api/admin/comments/:id` - Edits comments content.
* `DELETE /api/admin/comments/:id` - Deletes comments from stories.
* `GET /api/admin/users` - Lists registered accounts.
* `PUT /api/admin/users/:id` - Updates user details.
* `DELETE /api/admin/users/:id` - Deletes user account.
* `POST /api/admin/users/:id/status` - Toggles account state (`suspended`, `banned`).
* `POST /api/admin/users/:id/force-unfollow` - Admin force unfollow action.
* `POST /api/admin/users/:id/warn` - Logs a policy warning.
* `GET /api/admin/users/:id/warnings` - Fetches logged warnings list.
* `GET /api/admin/users/:id/relationships` - Returns social graph links.
* `GET /api/admin/users/:id/audit` - Audit log filter for specific user.
* `PUT /api/admin/users/:id/permissions` - Admin updates user permissions.
* `GET /api/admin/categories` - Lists taxonomies.
* `POST /api/admin/categories` - Adds a category.
* `DELETE /api/admin/categories/:id` - Removes a category taxonomy.
* `GET /api/admin/reports` - Lists incoming abuse tickets.
* `POST /api/admin/reports/:id/status` - Updates ticket status.
* `POST /api/admin/reports/:id/reply` - Posts response message to ticket threads.
* `GET /api/admin/reports/aggregated` - Summary dashboard metrics for tickets.
* `GET /api/admin/reports/target` - Reviews reports filtered by target asset.
* `GET /api/admin/bans` - Lists active blockages.
* `POST /api/admin/ban` - Bans IP or fingerprint identifier.
* `DELETE /api/admin/bans/:id` - Lifts ban status.
* `GET /api/admin/canned-responses` - Lists saved response text templates.
* `POST /api/admin/canned-responses` - Creates canned template.
* `GET /api/admin/support-agents` - Lists provisioned ticket agents.
* `GET /api/admin/audit-log` - Returns the general audit event register.
* `POST /api/admin/mfa-setup` - Sets up admin TOTP MFA code.
* `POST /api/admin/mfa-enable` - Activates MFA requirements.
* `POST /api/admin/mfa-verify` - Verifies token authentication for MFA.
* `GET /api/admin/books` - Lists books.
* `GET /api/admin/books/pending` - Lists pending contributor books.
* `POST /api/admin/books` - Creates new book catalog.
* `PUT /api/admin/books/:id` - Updates book information.
* `DELETE /api/admin/books/:id` - Removes book.
* `POST /api/admin/books/bulk-upload` - Parses bulk uploads.
* `POST /api/admin/books/:id/approve` - Approves contributor book.
* `PUT /api/admin/books/:id/status` - Updates book publication state.
* `PATCH /api/admin/books/bulk-update-category` - Modifies categories bulk.
* `PATCH /api/admin/books/bulk-update-status` - Modifies statuses bulk.
* `GET /api/admin/crm-analytics` - CRM analytics data.
* `GET /api/admin/analytics` - System analytics data.
* `GET /api/admin/accounts` - Lists tenant accounts.
* `GET /api/admin/employees` - Lists employee database entries.
* `POST /api/admin/system/purge-expired` - Cleans old logs and temporary tables.
* `GET /api/admin/tax/categories/:id` - Details ticket taxonomy.
* `PUT /api/admin/tax/categories/:id` - Edits category.
* `DELETE /api/admin/tax/categories/:id` - Deletes category.
* `PUT /api/admin/tax/subcategories/:id` - Edits subcategory.
* `DELETE /api/admin/tax/subcategories/:id` - Deletes subcategory.
* `PUT /api/admin/accounts/:id` - Edits tenant account.
* `DELETE /api/admin/accounts/:id` - Deletes account.
* `PUT /api/admin/roles/:id` - Edits role.
* `DELETE /api/admin/roles/:id` - Deletes role.
* `PUT /api/admin/roles/:id/permissions` - Edits permissions.
* `PUT /api/admin/teams/:id` - Edits team.
* `DELETE /api/admin/teams/:id` - Deletes team.
* `PUT /api/admin/employees/:id` - Edits employee.
* `DELETE /api/admin/employees/:id` - Deletes employee.
* `DELETE /api/admin/employees/:id/overrides/:overrideId` - Removes permission overrides.
* `PUT /api/admin/employee-chat/:id/status` - Updates employee availability.
