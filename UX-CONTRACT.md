# Timzee interface contract

## Business and data sources

The feature scope is described in `README.md`. Authentication and role checks
come from `assets/js/auth.js`, `assets/js/supabase.js` and
`netlify/functions/_lib/auth-role.js`. Database policies and migrations remain the
source for server permissions. Public submission behavior is in
`assets/js/forms.js` and its existing SQL validation migration. Legal copy remains
in the existing policy pages. This redesign introduces no prices, new roles,
retention promises or operational guarantees.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Table Selection | Existing staff feature modules | Feature IDs and server permissions | Individual actions; no invented bulk selection | Authenticated staff route checks; live destructive flows deferred |
| Select/Listbox | native | Browser select plus forms.css/design-system.css | Native single/multi select | Browser keyboard behavior, field labels, overflow checks |
| Date | native | Existing date/datetime-local controls | Browser picker; existing locale/timezone conversions | JavaScript checks; schedule business behavior unchanged |
| Form | assets/js/ui-controls.js | HTML constraints plus feature/API validation | Public, account, staff; feature-specific status messages | Inline errors, duplicate submission and failure recovery tests |
| Scrollbar | assets/css/design-system.css | Shared surface/border tokens | Bounded media/chat/table scrolling | Desktop/mobile route tests; standards and WebKit CSS |
| Toast | assets/js/theme-init.js | appUI.toast, siteToast compatibility alias | info, success, warning, error | Role/status semantics and form failure tests |
| CRUD | Existing feature module and backend endpoint | Supabase policies and Netlify handlers | Role-specific capabilities only | Local fixture flows and existing function tests; live role matrix deferred |

## Interaction rules

Navigation must work without waiting for authentication or settings requests.
Use real URLs for cards, profile links and recovery paths. Mobile tab labels must
match their destinations. Forms validate inline, focus the first invalid input,
associate errors with aria-describedby, keep a failed draft, and expose an
accessible status. Repeated submits must not create duplicate writes.

Server-backed search waits 300ms after typing, does not send partial IME text,
handles Enter and clear, preserves category and pagination, and ignores older
responses. Filters expose active state. Loading must end in populated, empty or
recoverable failure UI. A failed request is not an empty result.

Account settings save the latest changes even if edits arrive during a save.
Unsupported notification controls are removed. Cookie preference and measurement
choices persist independently. A settings guest can open cookie choices and
reach sign-in; account actions stay unavailable until signed in.

Confirmations and group/settings dialogs use native modal containment. Other
legacy feature overlays are listed in the review as remaining work; do not claim
that all overlays have been migrated. Native browser select/date pickers are an
intentional accessibility and maintenance choice.

Chat history belongs to a selection generation; late responses must not replace
the active conversation. Draft text and attachments stay with their conversation
while the page is open. Connection labels reflect subscription status, and
retries retire old channels. People discovery searches public names/usernames
with the shared debounce policy; the inbox filter uses cached previews.

## Verification and limits

`npm run build`, `npm test`, and `npm run test:browser` are the repeatable gates.
`tests/browser/experience.spec.cjs` covers every HTML entry point and the shared
flows, with synthetic member/staff roles and intercepted APIs. Axe checks selected
representative surfaces. These tests make no production writes and do not verify
live OAuth, email delivery, Supabase permissions, media processing or capacity.

The premium skill's static auditor must be run in strict mode. It assumes inline
click handlers and therefore reports externally bound buttons as actionless.
Record its actual findings and compare them with JS handlers/runtime tests;
never add empty onclick attributes merely to silence it. Runtime-owned textarea
styles and JS template forms can also need manual review. A nonzero static result
must be reported honestly rather than described as a passing certification.
