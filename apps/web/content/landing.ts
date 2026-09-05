import type { ComparisonTableProps } from "../components/ComparisonTable";
import type { DataFlowMatrixProps } from "../components/DataFlowMatrix";
import type { ExplainableReceiptProps } from "../components/ExplainableReceipt";
import type { FaqProps } from "../components/Faq";
import type { FooterProps } from "../components/Footer";
import type { HeroProps } from "../components/Hero";
import type { InstallBlockProps } from "../components/InstallBlock";
import type { NavProps } from "../components/Nav";
import type { PipelinePlateProps } from "../components/PipelinePlate";
import type { QuietCountersProps } from "../components/QuietCounters";
import type { RulesPlateProps } from "../components/RulesPlate";
import type { StatusLineProps } from "../components/StatusLine";
import type { ThemeToggleProps } from "../components/theme/ThemeToggle";

/**
 * Every string and URL on the landing page. Components take these as props, so wiring real
 * destinations later means editing this file only.
 *
 * TODO placeholders (no such destination exists yet):
 * - `androidBuild`: there is no published APK; the releases page stands in for a download link.
 * - `changelog`: the repository has no CHANGELOG yet; releases stand in for it.
 */
const repo = "https://github.com/redsteadz/relay";
const docsRoot = `${repo}/blob/dev/docs`;

const urls = {
  repo,
  androidBuild: `${repo}/releases`,
  privacyModel: `${docsRoot}/security/privacy.md`,
  docs: `${docsRoot}/memory/index.md`,
  operations: `${docsRoot}/operations/cloudflare.md`,
  actionModel: `${docsRoot}/architecture/action-model.md`,
  issues: `${repo}/issues`,
  issueMap: `${docsRoot}/memory/issue-map.md`,
  security: `${repo}/security/policy`,
  licence: `${repo}/blob/dev/LICENSE`,
  changelog: `${repo}/releases`,
} as const;

const wordmark = { label: "Relay", href: "#top" };
const androidCta = { label: "Get the Android build", href: urls.androidBuild };

export const landing = {
  site: {
    title: "Relay · Your notifications, with receipts",
    description:
      "Relay turns Gmail, Android notifications, and SMS into a quiet, explainable inbox and actions you approve. Open source, self-hostable, AGPL-3.0.",
    skipLink: "Skip to content",
  },

  themeToggle: {
    label: "Theme",
    options: { system: "Auto", light: "Light", dark: "Dark" },
  } satisfies ThemeToggleProps,

  nav: {
    wordmark,
    navLabel: "Primary",
    links: [
      { label: "How it reads", href: "#how" },
      { label: "Your data", href: "#data" },
      { label: "Self-host", href: "#self-host" },
      { label: "Source", href: urls.repo },
    ],
    cta: androidCta,
  } satisfies Omit<NavProps, "actions">,

  hero: {
    id: "top",
    eyebrow: "Gmail · Android notifications · SMS → one quiet inbox",
    title: ["Your notifications,", "with receipts."],
    subtitle:
      "Relay turns the mail and notifications you choose into a quiet, explainable inbox and actions you approve. Every item keeps its receipt: what arrived, what Relay read, how it was filed, what it proposes.",
    primaryCta: androidCta,
    secondaryCta: { label: "Read the privacy model", href: urls.privacyModel },
    trust: [
      "Open source",
      "AGPL-3.0",
      "Android-first",
      "Self-hostable",
      "Encrypted before upload",
      "Bring your own OpenAI key",
    ],
  } satisfies Omit<HeroProps, "aside">,

  receipt: {
    title: "Example receipt for one notification",
    labels: {
      arrived: "01 · Arrived",
      read: "02 · Read",
      filed: "03 · Filed",
      proposed: "04 · Proposed",
    },
    arrived: {
      reference: "#e91c",
      source: "Messages · Example Bank · Today 12:41",
      sourceGlyph: "M",
      body: "EXBANK: Card ending 4111 charged USD 14.20 at NORTH STATION on 04 Sep 12:40.",
    },
    read: {
      confidence: "92% confidence",
      headline: "$14.20 at North Station",
      facts: [
        { key: "amount", value: "14.20 USD" },
        { key: "merchant", value: "North Station" },
        { key: "card", value: "••4111" },
      ],
    },
    filed: {
      category: "Finance · Card charges",
      version: "v3",
      mode: "Deterministic",
      summary: "3 checks matched · no model involved",
    },
    proposed: {
      provider: "Google Tasks",
      title: "Review North Station charge",
      due: "due 18:00",
      effect: { kind: "writes", label: "writes" },
    },
    actions: { approve: "Approve", edit: "Edit", skip: "Skip", undo: "Undo" },
    outcomes: {
      approved: "✓ Approved · sent to Google Tasks at 12:52",
      skipped: "Skipped · nothing sent",
    },
    footnote: "Nothing leaves Relay until you approve. The provider gets only the fields above.",
  } satisfies ExplainableReceiptProps,

  pipeline: {
    id: "how",
    eyebrow: "How it reads",
    title: "Four steps. Each one leaves a record.",
    steps: [
      {
        title: "Capture",
        boundary: "On your device",
        body: "Only the sources you authorize. Fields are minimized and encrypted on the device before upload. Raw copies are deleted after seven days.",
      },
      {
        title: "Read",
        boundary: "Your server",
        body: "Amounts, dates, merchants, senders — each fact carries its certainty. A contradictory date is flagged for you, never guessed.",
      },
      {
        title: "File",
        boundary: "Your server · model only on fallback",
        body: "Rules in plain language compile to checks you can read. A model is asked only when no check covers it, only with your key, only with redacted fields.",
      },
      {
        title: "Act",
        boundary: "Provider · after you approve",
        body: "Actions are proposed, not taken. Approve, edit or skip; the provider receives exactly the fields you approved. Automation is explicit, per rule.",
      },
    ],
  } satisfies PipelinePlateProps,

  rules: {
    id: "rules",
    eyebrow: "Rules you can read",
    title: "Plain language in. A plan you can audit out.",
    body: "Describe a rule in sentences. Relay compiles it with the same code the pipeline runs, shows you the plan, and dry-runs it on invented items — nothing reaches a model and nothing can create an action. Every save is a new version; old ones stay inspectable.",
    bullets: [
      "Deterministic checks first. They cost nothing and disclose nothing.",
      "Semantic fallback is opt-in per rule, keyed by you, with a confidence floor.",
      "A rule decides what matches. Actions stay separate and wait for approval.",
    ],
    example: {
      intentLabel: "What should match",
      intent: "Sender contains example.test. Body contains charged. Amount is present.",
      intentSemantic: "Looks like a card purchase.",
      planLabel: "Compiled plan · All of",
      plan: ["Sender contains example.test", "Body contains charged", "Amount is present"],
      fallback: {
        label: "Semantic fallback",
        text: "“Looks like a card purchase” · 70% minimum · needs your key",
      },
      dryRunLabel: "Dry run · invented items",
      dryRunSummary: "1 match · 2 need a model",
      dryRun: [
        { name: "Receipt · SMS", result: "match", label: "Matches" },
        { name: "Delivery · Gmail", result: "model", label: "Needs a model" },
        { name: "Promotion · Notification", result: "model", label: "Needs a model" },
      ],
      disclosureNote:
        "If a model is asked it sees subject · sender · merchant · amount. Body excluded; card numbers and links redacted.",
    },
  } satisfies RulesPlateProps,

  dataFlow: {
    id: "data",
    eyebrow: "Your data",
    title: "Where each kind of data lives, and for how long.",
    body: "The same matrix is live inside the app, read from your account rather than from a policy page.",
    columns: ["Device", "Server", "Model", "Provider"],
    rows: [
      {
        label: "Raw capture",
        note: "Encrypted on device and server. Deleted after 7 days.",
        cells: ["minimized", "minimized", "never", "never"],
      },
      {
        label: "Facts & events",
        note: "A model sees redacted fields only on semantic fallback. Providers get only what you approved.",
        cells: ["stored", "stored", "minimized", "minimized"],
      },
      {
        label: "Categories & rules",
        note: "Every version appended, never rewritten.",
        cells: ["never", "stored", "never", "never"],
      },
      {
        label: "Approvals & actions",
        note: "Append-only ledger.",
        cells: ["never", "stored", "never", "stored"],
      },
      {
        label: "OpenAI key",
        note: "Envelope-encrypted by the backend. Never displayed again.",
        cells: ["never", "stored", "n/a", "never"],
      },
    ],
    legend: [
      { mark: "stored", label: "stored" },
      { mark: "minimized", label: "minimized or temporary" },
      { mark: "never", label: "never" },
    ],
    footnote:
      "Server means the Relay instance you point the app at: the one you self-host, or the maintainer-run one used for early testing. There is no separate Relay cloud, no account you can buy, and nothing that reads your data to sell it.",
  } satisfies DataFlowMatrixProps,

  quiet: {
    id: "why",
    title: "Quiet by default. Explainable by design.",
    body: "Relay is a foundation, not a finished product: an Android-first Expo app, a Cloudflare pipeline and a Supabase backend, all open. Sideload the development build, bring an OpenAI key if you want semantic fallback, and read every decision it makes.",
    primaryCta: androidCta,
    secondaryCta: { label: "Source on GitHub", href: urls.repo },
    counters: [
      { value: "7 days", label: "Raw copies live, then are deleted everywhere." },
      {
        value: "0",
        label: "Actions taken without your approval, unless a rule you wrote says so.",
      },
      { value: "Every", label: "Rule version kept. Every decision in an append-only ledger." },
      {
        value: "Yours",
        label: "The OpenAI key, sealed by the backend. Used only for semantic fallback.",
      },
    ],
  } satisfies QuietCountersProps,

  comparison: {
    id: "who-decides",
    eyebrow: "Who decides",
    title: "The question that separates a router from an assistant.",
    body: "Every tool in this space reads your messages. They differ in who gets to act on them, and whether you can see why.",
    contenders: [
      { name: "Relay", highlight: true },
      { name: "AI email assistants" },
      { name: "Notification automators" },
      { name: "Raw filters" },
    ],
    criteria: [
      {
        question: "Who decides what matters?",
        answers: [
          "Rules you wrote, compiled into checks you can read, with every version kept.",
          "The vendor's model, from your whole mailbox.",
          "Trigger recipes you wire together.",
          "String matches you maintain by hand.",
        ],
      },
      {
        question: "Who decides what happens?",
        answers: [
          "You, per action. Approval is the default; automatic is opt-in per rule.",
          "The assistant, often on its own.",
          "The recipe, every time it fires.",
          "The filter, every time it matches.",
        ],
      },
      {
        question: "What leaves your device?",
        answers: [
          "An encrypted capture with minimized fields. A model sees redacted fields only when you opted a rule into fallback.",
          "Full messages, to the vendor's servers.",
          "Full payloads, to the automation cloud.",
          "Nothing, but nothing gets extracted either.",
        ],
      },
      {
        question: "Can you see why?",
        answers: [
          "A receipt per item: facts, matched checks, rule version, and who approved.",
          "A summary, without provenance.",
          "A run log, if you dig.",
          "The rule itself, and no more.",
        ],
      },
      {
        question: "Can you undo or audit it?",
        answers: [
          "Append-only ledger. Approvals can be cancelled until dispatch; raw copies expire in seven days.",
          "Rarely, and not consistently.",
          "Per recipe, if the target service allows it.",
          "No record at all.",
        ],
      },
    ],
    ruleOfThumbLabel: "Rule of thumb",
    ruleOfThumb: "If you can't point at the rule and the approval, the decision wasn't yours.",
  } satisfies ComparisonTableProps,

  install: {
    id: "self-host",
    eyebrow: "Self-host",
    title: "Run the whole thing yourself.",
    body: "The API, the pipeline, the database migrations and the Android app live in one repository under AGPL-3.0. These commands bring the stack up locally on synthetic fixtures; the operations docs cover Cloudflare and Supabase for a hosted instance.",
    command: [
      "git clone https://github.com/redsteadz/relay.git && cd relay",
      "npx pnpm@11.23.0 install",
      "npx pnpm@11.23.0 supabase:start",
      "npx pnpm@11.23.0 --filter @relay/pipeline dev",
      "npx pnpm@11.23.0 --filter @relay/api dev",
    ].join("\n"),
    commandLabel: "Local stack",
    copy: { label: "Copy", copiedLabel: "Copied", failedLabel: "Copy failed" },
    requirementsLabel: "You need",
    requirements: [
      "Node.js 22 and pnpm 11",
      "Docker, for the local Supabase stack",
      "Android Studio, for the development build of the app",
      "A Cloudflare account and a Supabase project, for a hosted instance",
    ],
    docs: { label: "Read the operations docs", href: urls.operations },
  } satisfies InstallBlockProps,

  status: {
    id: "status",
    label: "Status",
    summary:
      "Relay is a walking skeleton. Capture, encryption, typed facts, compiled rules, dry runs and the approval ledger run end to end on synthetic fixtures. Provider dispatch is still switched off in the pipeline, Gmail OAuth verification is pending, and there is no production release yet.",
    items: [
      { label: "encrypted ingestion", state: "done" },
      { label: "typed facts & events", state: "done" },
      { label: "compiled rules & dry run", state: "done" },
      { label: "approval ledger", state: "done" },
      { label: "Google Tasks client", state: "done" },
      { label: "provider dispatch", state: "pending" },
      { label: "Gmail verification", state: "blocked" },
      { label: "release", state: "pending" },
    ],
    stateLabels: { done: "done", pending: "not yet", blocked: "blocked on external review" },
    link: { label: "Follow the issue map", href: urls.issueMap },
  } satisfies StatusLineProps,

  faq: {
    id: "faq",
    eyebrow: "Questions",
    title: "Asked before you install.",
    groups: [
      {
        title: "Your data",
        items: [
          {
            id: "faq-what-leaves-my-phone",
            question: "What leaves my phone?",
            answer:
              "A capture envelope with the fields you allowed, encrypted on the device before upload. The pipeline decrypts it in memory to extract facts, keeps the raw copy as ciphertext for seven days, then deletes it. A model sees redacted, allowlisted fields only when a rule you wrote opts into semantic fallback.",
          },
          {
            id: "faq-who-can-read-my-messages",
            question: "Who can read my messages?",
            answer:
              "Nobody, by default. Raw payloads are AES-GCM ciphertext under per-record keys wrapped by a versioned server keyring, rows are isolated per tenant with row-level security, and logs and metrics never carry bodies, senders or credentials. If you self-host, the server is yours too.",
          },
          {
            id: "faq-how-long-is-data-kept",
            question: "How long is data kept?",
            answer:
              "Raw copies: seven days, or sooner if you purge them. Extracted facts, events, categories, rules, disclosures and the action ledger stay until you delete them. Account deletion revokes provider credentials, invalidates devices and cascades every remaining row.",
          },
        ],
      },
      {
        title: "Actions",
        items: [
          {
            id: "faq-can-relay-act-without-me",
            question: "Can Relay act without me?",
            answer:
              "No. Every dispatch is an explicit approval; there is no autopilot mode. A rule can be switched to automatic only by you, per rule, after an explicit opt-in, and its runs are recorded in the same append-only ledger and can be cancelled before dispatch.",
          },
          {
            id: "faq-what-does-a-provider-receive",
            question: "What does a provider receive?",
            answer:
              "Only the fields of the action you approved, plus a stable Relay action ID used as an idempotency key so a retry can never create a second task or transaction. Google Tasks gets a title, notes, due date and list. Nextcloud Budget gets an amount as an exact decimal string, a type and the key.",
          },
          {
            id: "faq-same-message-twice",
            question: "What if the same message arrives twice?",
            answer:
              "It is deduplicated twice: by source identity and content fingerprint in the per-user coordinator, and finally by unique constraints in Postgres. Action IDs are derived from the rule and the event, so a redelivery converges on the run that already exists.",
          },
        ],
      },
      {
        title: "Sources",
        items: [
          {
            id: "faq-which-sources-work-today",
            question: "Which sources work today?",
            answer:
              "Gmail through OAuth, the History API and Pub/Sub for approved testing users; Android notifications through the system listener permission; and Android SMS in sideload builds only, limited to an exact sender allowlist you control.",
          },
          {
            id: "faq-is-there-an-ios-app",
            question: "Is there an iOS app?",
            answer:
              "No. iOS does not expose notifications or SMS to third-party apps, so the equivalent capture does not exist. Relay is Android-first by constraint, not preference.",
          },
          {
            id: "faq-do-i-need-an-openai-key",
            question: "Do I need an OpenAI key?",
            answer:
              "No. Deterministic checks run without one and disclose nothing. Add your own key to enable semantic fallback per rule. It is envelope-encrypted by the backend, never displayed again, and revoking it disables every rule that depended on it in the same transaction. The endpoint is configurable, so a gateway or a locally hosted model works too.",
          },
        ],
      },
      {
        title: "Self-hosting",
        items: [
          {
            id: "faq-what-do-i-need-to-self-host",
            question: "What do I need to self-host?",
            answer:
              "Node.js 22, pnpm 11 and Docker for the local Supabase stack. A hosted instance needs a Cloudflare account for the API and pipeline Workers, Queues and Durable Objects, plus a Supabase project. The operations docs walk through both.",
          },
          {
            id: "faq-is-there-a-hosted-version",
            question: "Is there a hosted version?",
            answer:
              "One maintainer-run instance exists for early testing and enrollment is operator-controlled. There is no Relay cloud plan and no account you can sign up for on this page.",
          },
        ],
      },
      {
        title: "Project",
        items: [
          {
            id: "faq-how-far-along-is-it",
            question: "How far along is it?",
            answer:
              "It is a walking skeleton. Capture, encryption, facts, events, rule compilation, dry runs and the approval ledger run end to end on synthetic fixtures. Provider dispatch, Gmail verification and a first release are tracked as open issues.",
          },
          {
            id: "faq-what-licence",
            question: "What licence is it under?",
            answer:
              "GNU Affero General Public License v3.0 or later. You can run it, change it and redistribute it; a hosted, modified version must publish its source.",
          },
          {
            id: "faq-report-a-security-issue",
            question: "How do I report a security issue?",
            answer:
              "Use GitHub private vulnerability reporting rather than a public issue, and never include real user data in a report. Maintainers acknowledge reports before publishing disclosure timelines.",
          },
        ],
      },
    ],
  } satisfies FaqProps,

  footer: {
    wordmark,
    navLabel: "Footer",
    links: [
      { label: "Docs", href: urls.docs },
      { label: "Privacy model", href: urls.privacyModel },
      { label: "Security policy", href: urls.security },
      { label: "Licence", href: urls.licence },
      { label: "Source", href: urls.repo },
      { label: "Issues", href: urls.issues },
      { label: "Changelog", href: urls.changelog },
    ],
    note: "AGPL-3.0-or-later · not a surveillance tool, an ad profile, or an autonomous agent",
  } satisfies FooterProps,
};
