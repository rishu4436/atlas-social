# ATLAS Social
<text color="secondary" size="sm">Complete Product & Engineering Blueprint — Version 1.0 | November 18, 2026</text>

<box border radius="xl" padding={3} gap={3}>
  <row justify="between" align="center">
    <title size="xl">ATLAS Social</title>
    <badge color="success">Architecture defined</badge>
  </row>
  <title size="lg" color="default">The Agent ID-Native Social Trading Network</title>
  A professional social platform where Agent ID holders build identities, publish market research, follow traders, join communities, verify trading performance and execute trades with explicit wallet authorization.
  <grid columns={2} gap={2}>
    {#each [{icon:"fingerprint",label:"Agent ID First"},{icon:"users",label:"SocialFi Native"},{icon:"chart-candlestick",label:"Trading Integrated"},{icon:"shield-check",label:"Verifiable Reputation"}] as item}
      <grid-item>
        <row align="center" gap={2}>
          <icon name={item.icon} color="secondary"/>
          <text size="sm" weight="medium">{item.label}</text>
        </row>
      </grid-item>
    {/each}
  </grid>
</box>

## 1. Our final product decisions

I'm locking the following decisions into the architecture we agreed upon.

| Area | Final specification |
|---|---|
| Primary identity | Binance Agent ID (`name.ai`) |
| Account rule | One Agent ID per ATLAS account |
| Authentication | Verified Agent ID ownership, secure returning sessions, optional account-bound passkey |
| Blockchain | BNB Smart Chain (chain ID 56) |
| Core experience | Social network + trading + AI research |
| Main differentiator | Immutable trade theses and verifiable performance |
| Trading model | Noncustodial, user-authorized spot trading |
| Social interactions | Fast, conventional app experience |
| On-chain interactions | Identity commitments, proofs, attestations and protected authorization |
| AI permissions | Research and analysis by default; no unrestricted financial execution |
| Privacy | Opt-in financial disclosures and isolated account data |
| Product design | Premium trading terminal meets modern social network |

One important point from the official announcement: Agent ID is a non-transferable identity tied to an Agentic Wallet, and each user can claim only one Agent ID. The hackathon rewards real Agent ID integration, verified BSC contracts and active on-chain participation. <Cite ref="turn933477view0"/>

## 2. Application architecture at a glance

<box border radius="xl" padding={3} gap={2}>
  <box background="surface-secondary" radius="lg" padding={3} gap={1} align="center">
    **ATLAS Web & Mobile Experience**
    <caption>Social feed · Markets · Squads · AI · Profile</caption>
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box border radius="lg" padding={3} gap={1} align="center">
    **Identity, API & Authorization Layer**
    <caption>Agent ID ownership · Social sessions · Account permissions · Risk policy</caption>
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <grid columns={2} gap={2}>
    <grid-item>
      <box border radius="md" padding={3} gap={1} height="100%">
        **Social Services**
        <caption>Posts, comments, follows, communities, messaging, notifications</caption>
      </box>
    </grid-item>
    <grid-item>
      <box border radius="md" padding={3} gap={1} height="100%">
        **Financial Intelligence**
        <caption>Market data, research agents, portfolio views, performance analytics</caption>
      </box>
    </grid-item>
  </grid>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <grid columns={2} gap={2}>
    <grid-item>
      <box background="surface-secondary" radius="md" padding={3} gap={1} height="100%">
        **Off-chain Infrastructure**
        <caption>PostgreSQL · Redis · Object storage · Indexer · Workers</caption>
      </box>
    </grid-item>
    <grid-item>
      <box background="surface-secondary" radius="md" padding={3} gap={1} height="100%">
        **BNB Smart Chain**
        <caption>Agent ID · Thesis Registry · Reviews · Proofs · Permissions</caption>
      </box>
    </grid-item>
  </grid>
  <row justify="center"><icon name="arrow-up-down" color="secondary"/></row>
  <box border radius="lg" padding={3} align="center" gap={1}>
    **Official Binance Agentic Wallet Integration**
    <caption>User-controlled signing, transaction preview and approval</caption>
  </box>
</box>

ATLAS never controls the user's wallet credentials or privately signs trades on their behalf.

### The authentication dependency we must validate

The official wallet skill supports EIP-712 signatures using Developer Mode, including a preview, execution and result-retrieval process. However, this is **not a documented one-click website login SDK**. <Cite ref="turn933477view2"/>

We will design Agent ID login around an ATLAS-specific signing challenge, with a compatible on-chain identity-proof fallback. We must test both against a genuine Agentic Wallet before treating either as production-ready.

The official Binance CLI's QR-based authentication is for connecting the user to Binance's own wallet environment. We cannot embed that authentication or pairing process into our third-party website; the hackathon explicitly prohibits it. <Cite refs={["turn933477view3","turn938803view0"]}/>

This is our first engineering gate, not something to discover after building the entire UI.

---

# Part I — Complete product experience

## 3. Main navigation and pages

I recommend five primary destinations, with secondary pages and contextual features accessed from them.

<box border radius="xl" padding={3} gap={3}>
  <row align="center" justify="between">
    <row align="center" gap={2}>
      <icon name="orbit" size="lg"/>
      **ATLAS**
    </row>
    <row align="center" gap={2}>
      <icon name="search"/>
      <icon name="bell"/>
      <box background="surface-secondary" radius="full" size="30px" align="center" justify="center">
        <icon name="user-round" size="sm"/>
      </box>
    </row>
  </row>
  <grid columns={5} gap={1}>
    {#each [{icon:"house",label:"Home"},{icon:"chart-candlestick",label:"Markets"},{icon:"users",label:"Squads"},{icon:"bot",label:"AI"},{icon:"user-round",label:"Profile"}] as item}
      <grid-item>
        <box background="surface-secondary" radius="lg" align="center" padding={2} gap={2} height="100%">
          <icon name={item.icon} size="lg"/>
          <text size="2xs" weight="medium">{item.label}</text>
        </box>
      </grid-item>
    {/each}
  </grid>
  <divider color="subtle"/>
  <text color="secondary" weight="medium" size="xs">MAIN CONTENT AREA — SOCIAL FEED CONCEPT</text>
  <box border radius="lg" padding={3} gap={2}>
    <row justify="between" align="center">
      <row align="center" gap={2}>
        <box background="surface-secondary" radius="full" size="38px" align="center" justify="center">
          <icon name="user-round"/>
        </box>
        <box gap="0">
          <text weight="medium">orion.ai</text>
          <caption>Agent ID verified · 12m ago</caption>
        </box>
      </row>
      <icon name="ellipsis"/>
    </row>
    **BNB Market Outlook — Breakout Watch**
    <text size="sm" color="secondary">Watching volume and liquidity near resistance. Thesis conditions are published on-chain and independently reviewable.</text>
    <box background="surface-secondary" padding={3} radius="md" gap={2}>
      <row justify="between" align="center">
        <text weight="medium" size="sm">BNB / USDT</text>
        <badge>Thesis committed</badge>
      </row>
      <svg viewBox="0 0 320 88" width="100%">
        <path d="M0 73 L20 69 L37 76 L58 58 L79 63 L101 46 L120 53 L141 48 L163 31 L185 40 L204 28 L226 35 L249 17 L266 22 L286 11 L320 15" fill="none" stroke="#16a34a" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round"/>
        <path d="M0 73 L20 69 L37 76 L58 58 L79 63 L101 46 L120 53 L141 48 L163 31 L185 40 L204 28 L226 35 L249 17 L266 22 L286 11 L320 15 L320 88 L0 88 Z" fill="#16a34a" opacity=".065"/>
        <line x1="0" x2="320" y1="45" y2="45" stroke="currentColor" strokeOpacity=".12" strokeDasharray="4 4"/>
      </svg>
      <caption>Illustrative chart, not market data</caption>
    </box>
    <row justify="between" align="center">
      <row gap={3}>
        <icon name="heart" color="secondary"/>
        <icon name="message-circle" color="secondary"/>
        <icon name="repeat-2" color="secondary"/>
      </row>
      <text size="xs" color="secondary">View verification</text>
    </row>
  </box>
  <caption>Illustrative information architecture. Final typography, charts and responsive layouts will use a coherent ATLAS design system.</caption>
</box>

### Route and feature inventory

| Screen | URL pattern | Core functionality |
|---|---|---|
| Welcome / Login | `/welcome` | Agent ID onboarding, sign-in, public browsing |
| Home Feed | `/home` | Following, discovery, trending posts, theses |
| Explore | `/explore` | Search creators, topics, markets and squads |
| Publish | `/compose` | Standard posts, polls, chart posts, structured theses |
| Thesis Detail | `/thesis/:id` | Thesis evidence, price context, reviews, performance |
| Markets | `/markets` | Price discovery, charts, market analytics |
| Market Detail | `/markets/:asset` | Chart, order-book/liquidity where available, related theses, trade preparation |
| Trading Workspace | `/trade/:asset` | Quote, position sizing, risk checks and wallet authorization |
| Squads | `/squads` | Discover communities, membership and discussions |
| Squad Detail | `/squads/:slug` | Research feed, shared watchlists and challenges |
| AI Research | `/ai` | Research workspace and thesis evaluation |
| Profile | `/u/:agentName` | Posts, public proofs, follows, reputation |
| Performance Lab | `/performance` | Transparent trader comparisons and methodology |
| Proof Explorer | `/proof/:id` | Blockchain references, attestations and evaluations |
| Notifications | `/notifications` | Social and proof-status updates |
| Messages | `/messages` | Private direct messaging |
| Settings | `/settings` | Identity, privacy, session security and preferences |
| Moderator Console | `/admin` | Reports, policy enforcement, abuse and incident review |

I would implement these as coherent app areas, not isolated landing pages.

## 4. The social feed

The feed is our primary daily-return feature.

It should combine ordinary social content with structured financial research.

### Supported content

<box gap={2}>
  <row align="start" gap={3}>
    <icon name="message-square-text" color="secondary"/>
    <box flex="1">
      **Normal post** — Text, media, topics, mentions and external links.
    </box>
  </row>
  <row align="start" gap={3}>
    <icon name="chart-no-axes-combined" color="secondary"/>
    <box flex="1">
      **Chart post** — A market snapshot with ticker, timeframe, timestamp and optional annotations.
    </box>
  </row>
  <row align="start" gap={3}>
    <icon name="clipboard-check" color="secondary"/>
    <box flex="1">
      **Verified thesis** — Structured market prediction committed on-chain.
    </box>
  </row>
  <row align="start" gap={3}>
    <icon name="shield-check" color="secondary"/>
    <box flex="1">
      **Verified trade** — An execution claim backed by sufficient attributable transaction evidence.
    </box>
  </row>
  <row align="start" gap={3}>
    <icon name="bot" color="secondary"/>
    <box flex="1">
      **AI research** — Automatically generated research with explicit AI labeling and source evidence.
    </box>
  </row>
  <row align="start" gap={3}>
    <icon name="users" color="secondary"/>
    <box flex="1">
      **Squad discussion** — Collaborative market research and community challenges.
    </box>
  </row>
</box>

### Feed algorithm

Three tabs:

- **Following:** Reverse chronological activity from followed accounts.
- **For You:** Personalized discovery using interests, social relationships, content quality and freshness.
- **Verified:** Theses, verified trade evidence and analysis with transparent provenance.

I would not rank posts primarily by trading profits or follower count. That creates incentives for exaggerated claims, excessive risk and artificial social engagement.

The recommendation algorithm should incorporate credible evidence, diversity, content recency, negative user feedback, and anti-spam signals.

Users should be able to select a non-personalized chronological feed.

---

# Part II — Identity, account security and user data

## 5. Agent ID-native signup and login

This is the most security-sensitive product workflow.

I recommend three authentication states:

| State | User experience | Permissions |
|---|---|---|
| Guest | Browse public ATLAS content | Public read only |
| Authenticated Agent ID account | Full social profile and normal social actions | Session-controlled |
| Freshly wallet-authorized | Publish protected on-chain evidence or approve supported blockchain operations | Operation-specific |

A social login must never authorize a trade.

### First-time account creation

<box gap={2}>
  {#each [
    {t:"Continue with Agent ID",d:"ATLAS creates a short-lived, single-use authentication challenge"},
    {t:"Authorize in the official wallet",d:"User signs an ATLAS-specific typed-data message in their own Agentic Wallet environment"},
    {t:"Verify wallet control",d:"ATLAS validates the signature, intended principal, chain, nonce, expiry and application domain"},
    {t:"Verify the Agent ID",d:"Read the official NFT contract on BSC; verify eligibility and, where supported, the exact identity token ownership"},
    {t:"Create the social account",d:"Atomically create a permanent UUID and one exclusive Agent ID association"},
    {t:"Register a passkey",d:"Bind a WebAuthn credential to the authenticated account for convenient returning login"},
    {t:"Enter ATLAS",d:"Create a secure session and load the user's isolated profile, feed and private settings"}
  ] as step,i}
    <row align="start" gap={3}>
      <box background="surface-secondary" radius="lg" size="32px" align="center" justify="center">
        <text weight="medium" size="sm">{i+1}</text>
      </box>
      <box flex="1" gap={1}>
        **{step.t}**
        <text color="secondary" size="sm">{step.d}</text>
      </box>
    </row>
  {/each}
</box>

The signature challenge should be an EIP-712 typed message specific to ATLAS. It should include a random nonce, short expiry, authentication purpose, origin/audience, intended wallet and server-issued login identifier.

The system must correctly verify the signature against the actual wallet principal. Support for externally owned accounts and contract-based signatures, such as ERC-1271 where applicable, must be tested against the real Agentic Wallet account type.

A matching NFT balance without valid wallet authorization is insufficient to log in.

### User interaction with the wallet

The documented signing sequence is:

```text
baw wallet settings
        ↓
baw sign-message preview
        ↓
Inspect authorization and risk result
        ↓
baw sign-message execute
        ↓
User confirms if required
        ↓
baw sign-message result
        ↓
ATLAS verifies returned signature
```

The signed challenge can be returned to ATLAS through an explicit, approved handoff or manually submitted signature. We should not imply the browser can directly control the CLI until a supported integration has been demonstrated. <Cite refs={["turn811452search0","turn938803view1"]}/>

### Returning login

After first-time identity verification, the user can register a passkey.

Returning login:

**Passkey → verify credential → resolve internal account → create secure session → load ATLAS.**

The passkey grants social-account access only. It does not prove fresh wallet authority for financial actions.

For high-risk account changes, such as removing authentication methods or registering a new passkey, require step-up authentication. If the original Agent ID wallet is inaccessible, account recovery must not allow an attacker to impersonate the on-chain identity.

### Identity invariants

We should enforce:

- One permanent Agent ID association per active ATLAS account.
- One Agent ID cannot belong to two ATLAS accounts.
- The verified wallet cannot be silently replaced.
- Public `.ai` names are never trusted as authentication credentials.
- All protected API actions resolve the user from their authenticated session.
- All protected on-chain actions independently validate the required authority.
- Original authorship and execution history are immutable.

If a user loses access to the original Agent ID, we may preserve access to private off-chain data through a secure recovery credential, but on-chain publishing and trading-proof attribution must remain disabled until the original identity is reverified.

A different Agent ID cannot inherit the original reputation merely through account recovery.

## 6. Public profile and privacy

An ATLAS profile should have three separate sections:

<box border radius="lg" padding={3} gap={3}>
  <row align="center" gap={3}>
    <box background="surface-secondary" radius="full" size="62px" align="center" justify="center">
      <icon name="user-round" size="2xl"/>
    </box>
    <box flex="1" gap={1}>
      <title size="lg">orion.ai</title>
      <row align="center" gap={1}>
        <icon name="badge-check" color="success" size="sm"/>
        <text size="sm" color="secondary">Verified Agent ID</text>
      </row>
      <caption>Market research • BNB Chain</caption>
    </box>
  </row>
  <grid columns={3} gap={2}>
    {#each [{v:"48",l:"Theses"},{v:"26",l:"Resolved"},{v:"1.2k",l:"Followers"}] as m}
      <grid-item>
        <box background="surface-secondary" radius="lg" padding={2} align="center" gap={1}>
          <title size="lg" tabularNums>{m.v}</title>
          <caption>{m.l}</caption>
        </box>
      </grid-item>
    {/each}
  </grid>
  <divider color="subtle"/>
  <row gap={2} wrap="wrap">
    <badge>Posts</badge>
    <badge>Theses</badge>
    <badge>Performance</badge>
    <badge>About</badge>
  </row>
  <caption>Illustrative fictional profile, not actual performance data.</caption>
</box>

**Social identity:** Username, biography, display image, follower counts, public posts and communities.

**Verifiable identity:** Agent ID eligibility, supported proof records, published theses and attributed trading evidence.

**Private account:** Bookmarks, personal notes, private watchlists, session history, private notifications and undisclosed financial positions.

A verified Agent ID badge must not be labeled "verified human" or "verified profitable trader." Those are different claims.

For AI-operated profiles, use a declared `AI Agent` classification, with distinct operator verification and disclosure of automated content.

The system must also warn that on-chain publication can reveal an address through public block explorers. Hiding the address in the frontend cannot make blockchain activity private.

## 7. User data isolation

Every ATLAS account receives an immutable UUID:

`users.id`

That UUID is the owner key for all private application records.

The Agent ID NFT is an externally verified, exclusive identity association—not a replacement for relational database keys.

### Database model

<box border radius="lg" padding={3} gap={2}>
  <box background="surface-secondary" radius="md" padding={3} gap={1}>
    **users**
    <caption>id · status · created_at · deleted_at</caption>
  </box>
  <row justify="center"><icon name="git-fork" color="secondary"/></row>
  <grid columns={2} gap={2}>
    {#each [
      {t:"identity_links",d:"Agent ID · token ID · wallet · proof"},
      {t:"passkeys",d:"Credential ID · public key · user ID"},
      {t:"sessions",d:"Device · expiry · revocation"},
      {t:"profiles",d:"Public name · bio · visibility"},
      {t:"posts",d:"Author · body · media · type"},
      {t:"theses",d:"Author · immutable evidence"},
      {t:"reviews",d:"Reviewer · claim · assessment"},
      {t:"follows",d:"Follower · followed user"},
      {t:"trade_proofs",d:"Attribution · transaction · status"},
      {t:"notifications",d:"Recipient · event · read state"},
      {t:"squads",d:"Creator · access policy"},
      {t:"saved_items",d:"User · private saved content"}
    ] as table}
      <grid-item>
        <box border radius="md" padding={2} gap={1} height="100%">
          <text weight="medium" size="sm">{table.t}</text>
          <caption>{table.d}</caption>
        </box>
      </grid-item>
    {/each}
  </grid>
</box>

### Critical database constraints

Use unique indexes on active Agent ID ownership associations and WebAuthn credential IDs.

A simplified SQL model:

<CodeBlock language="sql" editable>
CREATE TABLE users (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_id_links (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  chain_id BIGINT NOT NULL CHECK (chain_id = 56),
  agent_contract TEXT NOT NULL,
  token_id NUMERIC(78, 0) NOT NULL,
  wallet_address TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  UNIQUE (chain_id, agent_contract, token_id)
);

CREATE UNIQUE INDEX one_active_agent_wallet
ON agent_id_links (chain_id, lower(wallet_address))
WHERE revoked_at IS NULL;
</CodeBlock>

This is a schema illustration; production migrations should use validated binary address types or a strictly normalized representation, transactional link creation, and carefully designed historical uniqueness policies.

Every private query must be scoped to the authenticated `user_id`, including background jobs and real-time subscriptions.

Do not depend solely on frontend filtering. Enforce ownership at the API and database layers, and use PostgreSQL row-level security for defense in depth.

---

# Part III — Core social and financial workflows

## 8. Publishing posts and verified trade theses

ATLAS will distinguish ordinary social content from verifiable financial claims.

| Action | Authentication | Blockchain transaction? |
|---|---|---|
| Create ordinary post | Social session | No |
| Comment | Social session | No |
| Like/repost | Social session | No |
| Follow account | Social session | No |
| Create thesis draft | Social session | No |
| Publish verified thesis | Agent ID wallet authorization | Yes |
| Submit on-chain challenge | Agent ID wallet authorization | Yes |
| Attach off-chain evidence | Social session with proof checks | Depends on final attestation |
| Publish verifiable execution | Wallet proof plus independent validation | Evidence may be anchored on-chain |

### Verified thesis publishing

The user opens the composer, chooses **Trade Thesis**, and selects an asset, direction, entry conditions, invalidation level, target, time horizon and supporting research.

ATLAS shows an explicit summary of the prediction, calculates a deterministic commitment hash and prepares the registry transaction.

The user authorizes publication using the supported official wallet process.

Only after successful blockchain confirmation is the thesis displayed as `On-chain Committed`.

An unpublished draft never receives that badge.

The original conditions cannot be edited. Corrections are append-only, and the complete history remains accessible.

## 9. Proof of Performance

ATLAS's largest differentiation is distinguishing three fundamentally different types of evidence.

<grid columns={3} gap={2}>
  <grid-item>
    <box border radius="lg" padding={2} gap={2} height="100%">
      <icon name="clipboard-check" color="success" size="lg"/>
      **Prediction**
      <text size="xs" color="secondary">What did the trader say before the outcome?</text>
    </box>
  </grid-item>
  <grid-item>
    <box border radius="lg" padding={2} gap={2} height="100%">
      <icon name="activity" color="success" size="lg"/>
      **Outcome**
      <text size="xs" color="secondary">Did the market satisfy the original conditions?</text>
    </box>
  </grid-item>
  <grid-item>
    <box border radius="lg" padding={2} gap={2} height="100%">
      <icon name="wallet" color="success" size="lg"/>
      **Execution**
      <text size="xs" color="secondary">Did this trader actually place an attributable trade?</text>
    </box>
  </grid-item>
</grid>

A profitable-looking chart is not verified profit. A transaction hash alone is not proof that its publisher executed the trade.

The performance engine will use immutable thesis conditions, historical market data, transaction receipts and independently reconstructable asset movements.

Performance history should disclose sample size, fees, drawdowns, unresolved predictions and open positions.

### Resolution logic

For every thesis, store the predefined price source, observation window, target conditions, invalidation conditions and methodology version.

If evidence is sufficient, resolve the thesis according to the original rules. If sources disagree or intraperiod sequencing cannot be established, show `Unresolved` rather than choosing the result that benefits the author.

An outcome report must not automatically become a realized-P&L claim.

We will also preserve failed and cancelled published theses in the reputation dataset so creators cannot selectively hide losing ideas.

## 10. Trading from social posts

This is the financial workflow that should connect SocialFi to Binance Agentic Wallet.

<box gap={2}>
  <box background="surface-secondary" radius="md" padding={3} align="center">
    **User finds a trading thesis**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box border radius="md" padding={3} align="center">
    **Reviews thesis, author evidence and risk**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box border radius="md" padding={3} align="center">
    **Chooses independent order size, token and slippage limits**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box background="surface-secondary" radius="md" padding={3} align="center">
    **Official Agentic Wallet quote / simulation**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box border radius="md" padding={3} align="center">
    **User confirms the financial operation**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box border radius="md" padding={3} align="center">
    **Transaction executes and is independently verified**
  </box>
  <row justify="center"><icon name="arrow-down" color="secondary"/></row>
  <box background="surface-secondary" radius="md" padding={3} align="center">
    **Optional attribution to the original thesis**
  </box>
</box>

**Copy the strategy, not the risk.**

The follower is not required to use the author's order size or leverage. ATLAS treats the trading thesis as research input, not an executable instruction.

The trading workspace should show current market conditions, estimated costs, permitted route, slippage, projected price impact, token warnings and an explicit risk disclosure.

The user must approve the actual operation through the supported wallet workflow.

No blind auto-copy, unrestricted allowance, hidden fund movement or server-controlled user wallet session.

For the first release, focus on supported BSC spot swaps. RWA trading, perps and advanced execution can be integrated later under their own venue permissions, regulatory constraints and security evaluations.

## 11. AI research system

I would build ATLAS AI as an integrated research service—not a generic chatbot.

Four specialist components:

| Agent | Responsibility |
|---|---|
| Market Analyst | Price action, liquidity, market structure and historical conditions |
| Thesis Challenger | Identify assumptions, contradictory data and weaknesses |
| Risk Analyst | Evaluate downside exposure, execution risks and token-related threats |
| Research Synthesizer | Present evidence with sources, uncertainty and a readable conclusion |

The AI can also summarize discussions, explain charts and prepare a structured thesis draft.

However, AI-generated text is untrusted until independently validated. Social posts and external websites must never become instructions to use the wallet's signing capabilities.

A research agent cannot authorize trades, override wallet limits or grant itself additional permissions.

## 12. Squads and community features

Squads will give ATLAS a distinct community layer.

A squad is an Agent ID-centered discussion and research space.

The initial feature set includes community posts, member roles, shared watchlists, market discussions, collaborative thesis reviews and transparent competitions based on predefined evaluation rules.

The creator can appoint moderators for ordinary off-chain community operations. Protected blockchain actions still require appropriately authorized Agent ID interactions.

Do not pool user funds as part of normal squad membership.

A squad competition should compare documented predictions or attributable trading outcomes—not ask users to deposit assets into a shared high-risk contract.

## 13. Notifications and messaging

Notifications should include mentions, replies, followers, thesis outcomes, challenges, trade-proof status changes and relevant security events.

Every notification belongs to a specific internal user UUID and must be delivered only to that user's authorized active sessions.

For messaging, I recommend a private opt-in conversation system with abuse controls, rate limiting and encrypted-at-rest storage. It should not be marketed as end-to-end encrypted unless a proper client-side key management protocol is actually implemented.

The highest-priority anti-abuse features are block, mute, report, suspicious-link warnings, spam protection and account-specific moderation appeals.

---

# Part IV — Smart contracts and backend engineering

## 14. BNB Chain smart-contract architecture

I would deploy a small number of clearly separated, independently testable contracts.

| Contract | Responsibility | Primary functions |
|---|---|---|
| `AtlasIdentityRegistry` | Agent ID eligibility and account commitments | `registerIdentity`, `verifyIdentity` |
| `AtlasThesisRegistry` | Immutable financial prediction commitments | `publishThesis`, `appendCorrection` |
| `AtlasReviewRegistry` | Attributable reviews and evidence challenges | `publishReview`, `challengeEvidence` |
| `AtlasOutcomeRegistry` | Verifiable performance attestations and disputes | `proposeOutcome`, `challengeOutcome`, `finalizeOutcome` |

All contracts should be publicly verified on BscScan.

The official Agent ID address on BSC is:

<row align="center" gap={2}>
  <box background="surface-secondary" padding={2} radius="md" flex="1">
    <text size="xs">0x60b9262456de011f7d15a54cdd8c48baaa8b022f</text>
  </box>
  <button color="secondary" variant="outline" size="sm" onClick={()=>GenUI.copy("0x60b9262456de011f7d15a54cdd8c48baaa8b022f")}>
    <icon name="copy"/>
  </button>
</row>

The registry must validate the holder against this contract, using `balanceOf` for eligibility and verified token ownership for a particular identity where needed. <Cite ref="turn938803view0"/>

### Identity registration

A robust fallback for login authorization is an on-chain identity commitment.

The backend creates a short-lived random challenge. The user, using the official Agentic Wallet, submits a call to `registerIdentity` containing a commitment to that challenge.

The smart contract checks Agent ID ownership for the actual caller and emits a registration event.

The backend verifies the confirmed event, matches the challenge and atomically binds the identity to the new account.

This method produces genuine on-chain proof without asking the user to expose a wallet session to ATLAS.

The contract and application must prevent challenge reuse and account binding races.

### Thesis publication

A verified thesis includes:

```typescript
type Thesis = {
  authorId: string;
  chainId: 56;

  baseAsset: Address;
  quoteAsset: Address;

  direction: "LONG" | "SHORT";
  entryCondition: EntryCondition;
  targetCondition: PriceCondition;
  invalidationCondition: PriceCondition;
  evaluationDeadline: number;

  methodologyHash: Hex;
  contentHash: Hex;
};
```

A short prediction or a directional research claim need not imply leveraged trading. The direction is an analytical statement unless the user separately executes a supported financial position.

The smart contract anchors the hashes and authorized publisher. Full research content stays off-chain in durable, content-addressed storage.

### Outcome registry

Outcome verification requires additional care.

A historical market-price claim cannot be made trustworthy merely by writing it into a smart contract.

ATLAS should use an explicitly trusted and documented evaluator set initially, retain all underlying observations, support dispute windows and make evaluator attestations publicly auditable.

Over time, supported oracle-verifiable computations can reduce the trusted components.

The contracts should be as immutable and minimally privileged as practicable. Any owner authority to change evaluators, pause operations or upgrade modules must be disclosed.

There is no reason to deploy a pooled custody contract for the initial social application.

## 15. Application API specification

I would organize the backend into typed service modules with OpenAPI schemas.

| Module | Endpoints |
|---|---|
| Authentication | `/auth/challenge`, `/auth/verify`, `/auth/session`, `/auth/passkeys`, `/auth/logout` |
| Profiles | `/profiles/me`, `/profiles/:id`, `/profiles/:id/privacy` |
| Social | `/feed`, `/posts`, `/comments`, `/follows`, `/reactions` |
| Theses | `/theses`, `/theses/:id`, `/theses/:id/proofs`, `/theses/:id/reviews` |
| Markets | `/markets`, `/markets/:asset`, `/markets/:asset/history` |
| Trading | `/trade/prepare`, `/trade/quotes`, `/trade/evidence` |
| AI | `/research/analyze`, `/research/challenge`, `/research/explain` |
| Squads | `/squads`, `/squads/:id`, `/squads/:id/members` |
| Reputation | `/performance/:userId`, `/performance/methodology` |
| Notifications | `/notifications`, `/notifications/preferences` |
| Moderation | `/reports`, `/appeals`, `/admin/reviews` |

All write endpoints must be authenticated and authorized.

Public APIs should expose only permitted public fields.

For wallet operations, the backend prepares information or verifies results. It never secretly signs or broadcasts financial transactions.

### Backend technologies

<box gap={2}>
  <row align="center" justify="between">
    **Frontend**
    <text color="secondary" size="sm">Next.js + TypeScript + Tailwind</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **API**
    <text color="secondary" size="sm">Fastify + Zod + OpenAPI</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **Database**
    <text color="secondary" size="sm">PostgreSQL + TimescaleDB</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **Queues / caching**
    <text color="secondary" size="sm">Redis + BullMQ</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **BSC indexing**
    <text color="secondary" size="sm">Viem + reorg-aware event workers</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **Contracts**
    <text color="secondary" size="sm">Solidity + Foundry + OpenZeppelin</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **Analytics**
    <text color="secondary" size="sm">Python + Polars</text>
  </row>
  <divider color="subtle"/>
  <row align="center" justify="between">
    **Storage**
    <text color="secondary" size="sm">S3-compatible + pinned content-addressed evidence</text>
  </row>
</box>

### Suggested monorepo

<CodeBlock language="text" editable>
atlas-social/
├── apps/
│   ├── web/
│   ├── api/
│   └── admin/
├── packages/
│   ├── contracts/
│   ├── shared-types/
│   ├── agent-id/
│   ├── wallet-integration/
│   ├── auth/
│   ├── design-system/
│   └── trade-proof/
├── services/
│   ├── chain-indexer/
│   ├── market-data/
│   ├── outcome-engine/
│   ├── ai-research/
│   ├── notification-worker/
│   └── reputation-engine/
├── infrastructure/
├── docs/
│   ├── architecture/
│   ├── security/
│   ├── runbooks/
│   └── evidence/
└── tests/
    ├── integration/
    ├── security/
    └── e2e/
</CodeBlock>

This separates shared libraries from deployable services. It also makes it easier to test blockchain functionality independently from the social interface.

---

# Part V — Visual design system

## 16. Design philosophy

ATLAS should feel like a premium financial product with the approachability of a modern social platform.

I would avoid making every screen look like a conventional exchange terminal. That overwhelms social users.

Instead, the design should change emphasis according to context:

**Home:** Content-first, readable, expressive, minimal chart clutter.

**Markets:** Data-dense, fast scanning, technical charts and compact numbers.

**Thesis Review:** Evidence-first, with a clear separation between verified facts and opinions.

**Profile:** Reputation-focused, with high-quality statistical presentations.

**AI:** Research-workspace experience with sources, confidence and transparent reasoning.

### Proposed visual tokens

<box border radius="xl" padding={3} gap={3} theme="dark">
  <row align="center" gap={2}>
    <box background="#080D14" border={{size:1,color:"#334155"}} size="44px" radius="lg"/>
    <box flex="1" gap="0">
      **Obsidian**
      <caption>#080D14 — Application background</caption>
    </box>
  </row>
  <row align="center" gap={2}>
    <box background="#111827" border={{size:1,color:"#334155"}} size="44px" radius="lg"/>
    <box flex="1" gap="0">
      **Slate**
      <caption>#111827 — Main cards and surfaces</caption>
    </box>
  </row>
  <row align="center" gap={2}>
    <box background="#46E1DF" size="44px" radius="lg"/>
    <box flex="1" gap="0">
      **Signal Cyan**
      <caption>#46E1DF — Primary identity/action accent</caption>
    </box>
  </row>
  <row align="center" gap={2}>
    <box background="#34D399" size="44px" radius="lg"/>
    <box flex="1" gap="0">
      **Emerald**
      <caption>#34D399 — Positive financial states</caption>
    </box>
  </row>
  <row align="center" gap={2}>
    <box background="#FB7185" size="44px" radius="lg"/>
    <box flex="1" gap="0">
      **Coral**
      <caption>#FB7185 — Negative financial states</caption>
    </box>
  </row>
</box>

These are proposed product tokens, not an existing design asset.

I would use a clean sans-serif family such as Geist or Inter for the interface, with tabular numerals and a restrained monospaced style for hashes and transaction identifiers.

Color should never be the only way to convey financial results or verification states.

### Responsive layout

On desktop: left sidebar for navigation, central content, right contextual panel.

On mobile: bottom navigation, swipeable content, full-screen chart and trading experiences.

Accessibility must include readable contrast, keyboard navigation, visible focus states, screen-reader labels and reduced-motion support.

---

# Part VI — Security architecture

## 17. Non-negotiable security controls

<box gap={3}>
  <row gap={3} align="start">
    <icon name="key-round" size="lg" color="secondary"/>
    <box flex="1" gap={1}>
      **Authentication security**

      WebAuthn/passkeys, short-lived login challenges, session rotation, secure cookies, CSRF protection, single-use nonces, step-up authorization and credential recovery controls.
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <icon name="database" size="lg" color="secondary"/>
    <box flex="1" gap={1}>
      **Data isolation**

      Strict internal UUID ownership, foreign-key relationships, transactionally enforced identity uniqueness, authorization middleware, row-level security, user-scoped caches and authenticated WebSocket channels.
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <icon name="wallet" size="lg" color="secondary"/>
    <box flex="1" gap={1}>
      **Financial security**

      No custody of keys, no backend wallet sessions, no hidden transfers, explicit transaction confirmation, supported wallet previews, minimum necessary approvals and independent transaction verification.
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <icon name="brain-circuit" size="lg" color="secondary"/>
    <box flex="1" gap={1}>
      **AI security**

      Tool isolation, untrusted-content boundaries, restricted financial permissions, provenance tracking, structured output validation and prompt-injection testing.
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <icon name="shield-alert" size="lg" color="secondary"/>
    <box flex="1" gap={1}>
      **Social abuse protection**

      Rate limits, spam detection, impersonation prevention, reporting, moderation appeals, suspicious-link scanning and protection against manipulated performance rankings.
    </box>
  </row>
</box>

The official rules expressly prohibit QR/pairing-code logins on third-party sites, bypassing financial confirmations, hidden transfers, undisclosed administrative powers and collection of wallet secrets. Trading pages must also display risk warnings. <Cite ref="turn938803view0"/>

### Test scenarios that must pass

| Test | Required result |
|---|---|
| User A requests User B's private bookmarks | Access denied |
| Same Agent ID attempts a second account registration | Rejected |
| Someone submits a copied wallet signature | Rejected if nonce used, expired or context-mismatched |
| User switches devices or accounts | No private data contamination |
| Attacker claims another person's trade hash | Proof rejected |
| Someone attempts to modify an on-chain thesis after publication | Original commitment unchanged |
| AI-generated post contains malicious signing instructions | Agent tooling ignores those instructions |
| Official wallet preview rejects a contract call | ATLAS cannot execute through a bypass |
| Block reorganization affects a recorded proof | Indexer reconciles and corrects provisional state |
| Price oracle data is missing or stale | Outcome remains unresolved |
| Session expires during a protected write | Operation fails and requires reauthentication |
| Moderator removes a harmful post | Off-chain visibility changes; immutable on-chain records are not misrepresented as deleted |

Security acceptance must include Foundry invariants, fuzz tests, API authorization tests, browser end-to-end tests, dependency audits and an independent contract review before allowing meaningful financial value to pass through any custom contract.

---

# Part VII — Build sequence and acceptance gates

## 18. Delivery plan aligned with the actual hackathon

The official submission window closes **December 9, 2026 at 08:00 UTC (1:30 PM IST)**. A live product, open-source verified contracts and at least 30 eligible Agent ID interacting addresses are essential for the Innovation Award. <Cite ref="turn933477view1"/>

I would structure delivery as follows.

<box gap={3}>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">01</text>
    </box>
    <box flex="1" gap={1}>
      **Identity foundation — November 18–21**

      Validate official wallet signing, deploy an Agent ID-gated registration contract, implement proof verification, internal accounts, secure sessions and passkeys.

      <text color="success" size="sm" weight="medium">Gate: One real Agent ID user signs in, returns securely and performs a genuine contract interaction.</text>
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">02</text>
    </box>
    <box flex="1" gap={1}>
      **Social foundation — November 22–25**

      Implement profiles, posts, follows, comments, feed ranking, bookmarks, notifications and responsive design.

      <text color="success" size="sm" weight="medium">Gate: Multiple users can interact without account-data contamination.</text>
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">03</text>
    </box>
    <box flex="1" gap={1}>
      **Thesis and proof infrastructure — November 26–29**

      Deploy the thesis contract, implement structured thesis publishing, chain indexing, integrity verification and market-history storage.

      <text color="success" size="sm" weight="medium">Gate: A third party can verify a real published thesis and its original conditions independently.</text>
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">04</text>
    </box>
    <box flex="1" gap={1}>
      **Research and performance — November 30–December 3**

      Build AI analysis, market-evidence assessment, review challenges, execution attribution and reputation statistics.

      <text color="success" size="sm" weight="medium">Gate: False trading claims are rejected and verifiable outcomes are reproducible.</text>
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">05</text>
    </box>
    <box flex="1" gap={1}>
      **Wallet trading integration — December 4–6**

      Implement market views, trade preparation, supported wallet execution handoff, transaction receipts and appropriate financial risk disclosures.

      <text color="success" size="sm" weight="medium">Gate: One explicitly authorized genuine trade can be traced end-to-end, without a backend wallet session.</text>
    </box>
  </row>
  <divider color="subtle"/>
  <row gap={3} align="start">
    <box background="surface-secondary" size="38px" radius="lg" align="center" justify="center">
      <text weight="medium">06</text>
    </box>
    <box flex="1" gap={1}>
      **Validation and submission — December 7–9**

      Complete security testing, mainnet evidence, verified contract source, project documentation, actual user onboarding, demonstration and submission.

      <text color="success" size="sm" weight="medium">Gate: Fully inspectable live submission with at least 30 legitimate Agent ID participants.</text>
    </box>
  </row>
</box>

These dates are proposed engineering milestones, not a guarantee of completion. The authentication gate is deliberately first because an unsupported signing experience would invalidate the intended onboarding UX.

Features such as advanced squad competitions, encrypted direct messaging, multiple market venues and complex RWA trading can be implemented later. They remain part of the product architecture, but should not displace the core verified social-trading workflow before submission.

## 19. Definition of done

For the hackathon, I would consider the project ready only when:

<box border radius="lg" padding={3} gap={2}>
  {@body const gates = ["Official Agent ID authentication successfully validated","One identity cannot create or control multiple active social accounts","Private data cannot leak between user sessions","A real Agent ID holder can publish an on-chain verified thesis","A second holder can review or challenge it through the contract","Market outcomes can be reproduced from declared evidence","A copied or falsely attributed trade proof is rejected","Wallet execution respects user previews and confirmation","Contracts are open-source and verified on BscScan","At least 30 eligible Agent ID holders complete genuine contract interactions","Production site, tests, documentation and demo are complete"]}
  {@body const [checked,setChecked] = DIL.useState([])}
  <row justify="between" align="center">
    **Release acceptance checklist**
    <text color="secondary" size="xs" tabularNums>{checked.length}/{gates.length} manually checked</text>
  </row>
  <box background="surface-tertiary" height="6px" radius="full" clip>
    <box background="#16a34a" width={`${100*checked.length/gates.length}%`} height="100%" radius="full"/>
  </box>
  {#each gates as gate,i}
    <checkbox key={i} checked={checked.includes(i)} lineThrough={false} onChange={v=>setChecked(old=>v?[...old,i]:old.filter(x=>x!==i))}>
      <text size="sm">{gate}</text>
    </checkbox>
  {/each}
  <caption>This is a planning checklist, not a claim that implementation or verification has already occurred.</caption>
</box>

## 20. What wins the hackathon

For the live demonstration, I would avoid giving judges a tour of every page.

The presentation should prove the complete Agent ID value chain:

<box border radius="lg" padding={3} gap={2}>
  <row align="center" gap={2}>
    <icon name="fingerprint" color="secondary"/>
    **Agent ID login**
  </row>
  <text size="sm" color="secondary">A user authenticates with the proper wallet proof and opens their persistent ATLAS profile.</text>
  <divider color="subtle"/>
  <row align="center" gap={2}>
    <icon name="clipboard-check" color="secondary"/>
    **Publish a verified thesis**
  </row>
  <text size="sm" color="secondary">The user commits an immutable financial prediction through the ATLAS contract.</text>
  <divider color="subtle"/>
  <row align="center" gap={2}>
    <icon name="users" color="secondary"/>
    **Social verification**
  </row>
  <text size="sm" color="secondary">Another Agent ID holder challenges or reviews the prediction with attributable evidence.</text>
  <divider color="subtle"/>
  <row align="center" gap={2}>
    <icon name="chart-candlestick" color="secondary"/>
    **Trading integration**
  </row>
  <text size="sm" color="secondary">A user analyzes the thesis, constructs their own trade and authorizes execution through the supported wallet workflow.</text>
  <divider color="subtle"/>
  <row align="center" gap={2}>
    <icon name="shield-check" color="secondary"/>
    **Independent proof**
  </row>
  <text size="sm" color="secondary">Judges inspect the transaction, identity authorization, thesis commitment, outcome report and evidence-backed reputation.</text>
</box>

The performance demonstration should use genuinely completed historical observations or clearly labeled simulations, rather than fabricating results during the presentation.

The two target award categories assess real Agent ID participation and functional application innovation. One project cannot collect both project awards. <Cite ref="turn933477view1"/>

---

# Final recommendation

The blueprint now establishes the product's identity, interaction model, system boundaries, data ownership, financial safeguards and execution roadmap.

The foundational feature is not simply a social feed or a trading terminal.

It is **a persistent Agent ID-associated social reputation system in which financial claims can be checked against immutable predictions and independently verifiable outcomes**.

That provides real reasons to use Agent ID: attributable publication, community accountability, reputation, service access and participation in financial workflows.

I would start implementation with the **Agent ID authentication and on-chain identity-registration vertical slice**, then build the social foundation around it. Until that real-wallet integration has been validated, the design is specified but not technically proven.

The official references for that first engineering milestone are the <Link url="https://github.com/binance/binance-skills-hub/blob/main/skills/binance-web3/binance-agentic-wallet/references/external-sign.md" title="Agentic Wallet external-sign specification"/> and the <Link url="https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf" title="Agent ID Hackathon rules"/>.

**ATLAS Social is now defined sufficiently to hand to an engineering team or coding agent as the basis for implementation.**