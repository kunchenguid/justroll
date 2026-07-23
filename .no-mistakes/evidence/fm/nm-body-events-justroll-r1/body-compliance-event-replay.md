# PR body compliance event replay

This targeted replay validates the repository-specific rollout against the
merged policy in `kunchenguid/no-mistakes#558`. The workflow-only diff matches
the upstream `run-name` and concurrency hunks exactly.

The replay uses three PR-body events on the same head and executes the actual
`Verify no-mistakes signature in PR body` shell block extracted from
`.github/workflows/no-mistakes-required.yml`.

| Run ID | Run number | Action | Concurrency group | Status | Conclusion |
| ---: | ---: | --- | --- | --- | --- |
| `29962844999` | 586 | opened | `no-mistakes-required-549-29962844999` | completed | success |
| `29962943078` | 587 | edited | `no-mistakes-required-549-29962943078` | completed | failure |
| `29965243268` | 588 | edited | `no-mistakes-required-549-29965243268` | completed | success |

## Reviewer-visible run names

```text
PR #549 body compliance - opened - event 586 (run 29962844999)
PR #549 body compliance - edited - event 587 (run 29962943078)
PR #549 body compliance - edited - event 588 (run 29965243268)
```

The monotonic run numbers expose event ordering. The immutable run IDs appear
in both the display names and the body-event concurrency groups.

## Actual compliance-step output

### Signed opened event

```text
Found no-mistakes signature in PR #549 body.
```

Exit status: `0` (`success`)

### Unsigned edited event

```text
::error::This PR was not raised through no-mistakes.

Contributions to this repository must be submitted via 'git push no-mistakes'.
That pipeline runs the required review/test/lint/CI steps and writes a
deterministic '## Pipeline' section into the PR body containing:

    Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)

See CONTRIBUTING.md for setup and the full workflow.

PR author: first-time-fork-contributor
```

Exit status: `1` (`failure`)

### Signed edited event

```text
Found no-mistakes signature in PR #549 body.
```

Exit status: `0` (`success`)

## Preserved head-change coalescing

```text
synchronize: no-mistakes-required-549-head-change
reopened:    no-mistakes-required-549-head-change
```

## Preserved workflow contract

The focused contract assertions confirmed:

- only `.github/workflows/no-mistakes-required.yml` changed;
- the trigger remains `pull_request` for `opened`, `edited`, `synchronize`, and
  `reopened` against `main`;
- permissions remain exactly `contents: read`;
- there is no `pull_request_target`, write permission, secret reference,
  checkout, or fork-code execution;
- the stable check name, signature marker, three bot exemptions,
  and `cancel-in-progress: true` remain unchanged.

No screenshot was captured because the changed surface is GitHub Actions
scheduling and shell behavior, not a locally rendered UI. This transcript shows
the end-user-visible run titles, terminal outcomes, and compliance messages.
