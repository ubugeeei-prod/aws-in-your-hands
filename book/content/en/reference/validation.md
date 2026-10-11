---
title: "Validation Record"
generated: true
---

<!-- Generated file. Do not edit. Source: data/validation.json (tools/src/book/generate.ts) -->

# Validation Record

This page keeps what was written apart from what was run and confirmed. A local pass is not evidence that something works in AWS.

Environment: macOS 26 (Darwin 25.6.0), arm64 (aarch64-darwin), Nix 2.25.3 (2026-10-11)

| Scope | Command | Kind | Result | Ran | Note |
| --- | --- | --- | --- | --- | --- |
| toolchain | `nix develop` | local | passed | 2026-10-11 | Node.js 24.21.0, pnpm 10.34.5, AWS CLI 2.35.11, and vp 1.1.0 are present, and vp env which node points at the Nix Node.js |
| toolchain | `vp install --frozen-lockfile` | local | passed | 2026-10-11 | Installed without rewriting pnpm-lock.yaml |
| toolchain | `clean checkout: nix develop → vp install --frozen-lockfile → vp run check:all` | local | passed | 2026-10-11 | Run from a separate directory holding only the staged tree; no pre-generated file or globally installed tool was needed |
| toolchain | `vp の初回セットアップと shell 設定 / vp first-run setup and shell profiles` | local | passed | 2026-10-11 | Tested with a throwaway HOME: by default lines are appended to ~/.zshrc, ~/.zshenv, ~/.bashrc, and ~/.profile; with VP_SELF_SETUP_NO_MODIFY_PATH=1 nothing is appended |
| all | `vp run check:all` | local | passed | 2026-10-11 | Format and lint, type checks, Vue type check, 130 tests in 20 files, generated-page freshness, locale and source-map consistency, synth of four CDK apps, the book build, link check over 70 pages, and the SPA build |
| all | `vp run typecheck (6 回 / 6 times)` | local | passed | 2026-10-11 | Passed 6 of 6 times with single-threaded tsc. Default parallel tsc and vp check's type check intermittently failed on the same input |
| book | `vp run build:book / vp run links:check` | local | passed | 2026-10-11 | Generates 34 pages per language plus the 404 page and search index. Confirmed that a cache hit restores the output and that changing an imported source file or a page re-runs the build |
| book | `vp run book:infra:synth` | local | passed | 2026-10-11 | 5 resources and 3 outputs; no change to AWS |
| 02 | `vp run hello:infra:synth -c stage=prod / vp run hello:infra:synth:cdk` | local | passed | 2026-10-11 | Context reaches cdkd, and the template shows the bucket retained for prod. The CDK CLI synthesizes the same app |
| 03 | `vp run build:spa / vp run typecheck:vue` | local | passed | 2026-10-11 | Built with the Vize Vite plugin; output is 152 KB. vize check passed 8 of 8 runs and caught a deliberately introduced type error |
| 04 | `vp run dev:api + curl` | local | passed | 2026-10-11 | Ran the four curl commands from the chapter: /health, create, list, and the 400 for invalid input |
| 04 | `vp run api:infra:synth` | local | passed | 2026-10-11 | Includes the esbuild bundle (no Docker); 17 resources |
| 01 | `vp run account:whoami` | AWS | not run | - | Needs credentials |
| 01 | `vp run account:budget:create / account:budget:delete` | AWS | not run | - | Changes AWS |
| 02 | `vp run infra:bootstrap` | AWS | not run | - | Creates cdkd's storage |
| 02 | `vp run hello:infra:diff / deploy / drift / drift:revert:preview / drift:revert / drift:accept / destroy` | AWS | not run | - | Includes the drift lab |
| 03 | `vp run spa:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates a CloudFront distribution |
| 03 | `vp run spa:publish:plan / publish / smoke / invalidate / unpublish` | AWS | not run | - | Publishing and live-URL checks |
| 04 | `vp run dev:api:cdkd` | local | not run | - | Needs a Docker daemon; not run |
| 04 | `vp run api:infra:diff / deploy / drift / destroy` | AWS | not run | - | Creates Lambda and API Gateway resources |
| 04 | `vp run api:smoke / api:logs` | AWS | not run | - | Needs the deployed API |
| book | `vp run book:infra:diff / deploy / drift / destroy` | AWS | not run | - | The book site is not deployed |
| book | `vp run book:publish:plan / publish / smoke / invalidate / unpublish` | AWS | not run | - | There is no public URL yet |
| pricing | `vp run pricing:refresh` | AWS | not run | - | Reads a public API. data/pricing/unit-prices.json was extracted from the same API once by hand |
| distribution | `vp run sources:pack` | local | not run | - | Cannot run without a commit |

## Open items and how to resume

### aws-validation

Nothing has been validated in AWS, because this request did not authorize creating, changing, or deleting resources.

To resume: Follow the order under "最初に実行する実環境検証" in docs/CONTINUATION.md in an authorized practice account. Record results here and update `verification` in data/section-map.json.

### cdkd-cloudfront-function

cdkd 0.296.28 handles AWS::CloudFront::Function through Cloud Control API. Whether create, update, and drift read-back work in practice is unconfirmed. The book site and chapter 03 depend on it.

To resume: Run vp run spa:infra:deploy and vp run spa:infra:drift. If they fail, record how and ask the author for a decision; do not substitute another tool.

### cdkd-state-outputs

tools/src/infra/outputs.ts assumes cdkd state show --json prints { state: { outputs } }. The key format (bare or stack-qualified) is unconfirmed against real output; the code accepts both.

To resume: After a deploy, save the real output of cdkd state show AihHello --json and replace the fixture in tools/src/infra/outputs.test.ts with it.

### drift-fixtures

The files in tools/src/drift/fixtures/ were written by hand from cdkd's type definition and documented exit codes; they are not captured output.

To resume: Run the chapter 02 drift lab and add the real output for clean, drifted, and missing-stack runs as fixtures.

### sdk-aws-login

Whether AWS SDK for JavaScript v3 3.1149.0 can read aws login credentials (login_session) is unconfirmed.

To resume: Run vp run account:whoami after aws login. If it cannot read them, add the documented credential_process profile to chapter 01 as a procedure.

### platforms

Only aarch64-darwin was verified. The Linux autoPatchelf path in nix/vp.nix and x86_64-darwin have not been run.

To resume: Run nix develop, vp install --frozen-lockfile, and vp run check:all on each platform and update verifiedPlatforms in data/toolchain.json.

### typescript7-parallel-check

Parallel type checking in TypeScript 7.0.2, and vp check's type check, intermittently mis-resolve aws-cdk-lib subpath imports. Single-threaded tsc is used as a workaround. Not reported upstream.

To resume: Build a minimal reproduction and report it upstream. When a fix ships, revisit lint.options in vite.config.ts and tools/src/checks/typecheck.ts.

### ox-content-peer-range

The vite peer range of @ox-content/vite-plugin 3.2.14 does not include vite-plus-core 1.1.0. pnpm-workspace.yaml allows it with peerDependencyRules. The build works.

To resume: When upgrading Ox Content or Vite+, check whether the exception is still needed.

### custom-domain

A custom domain (Route 53, ACM) is not implemented. With no siteUrl, canonical and hreflang links are not emitted.

To resume: Once a domain exists, add the hosted zone and a us-east-1 certificate to book/infra/ and build with AIH_BOOK_SITE_URL set. First confirm that cdkd handles the cross-Region stack.

### cloudformation-drift

CloudFormation drift detection (start, polling to completion, result parser, gate) is not implemented; it belongs to chapter 20. The current gate covers cdkd-managed stacks only.

To resume: In chapter 20, add CloudFormation detection to tools/src/drift/ and feed it into the same report shape and gate.

### unverified-sources

Sources with checkedAt null in data/sources.json are listed as starting points and were not re-read while writing. Chapters 01 and 02 contain general statements about IAM, CDK bootstrapping, and CloudFormation drift that rest on such sources.

To resume: Re-read those sources and update checkedAt and supports. Where the prose disagrees, correct the Japanese first.

### unverified-prices

AWS Budgets pricing, free allowances for API Gateway HTTP API and S3, and which chapters run on the Free plan are unconfirmed. The calculations treat them as unknown and deduct nothing.

To resume: Check the official pricing pages and resolve the `unknown` entries in data/pricing/allowances.json.

### publication

The repository's public URL, where archives are published, and the license are undecided. The CI examples in docs/examples/ have never been executed.

To resume: The author decides. Once decided, write only real URLs into the README and the prose.
