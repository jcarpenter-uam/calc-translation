# CALC Translation Server

[**Client**](https://github.com/jcarpenter-uam/calc-translation-desktop)

## Overview

CALC Translation is designed for real-time captions and translated transcript delivery during meetings, while keeping access and administration scoped to the correct tenant.

The server supports the full meeting lifecycle: creating meetings, issuing join links and codes, coordinating live sessions, delivering transcript updates to participants, and preserving meeting output after the session ends.

## Features

- Real-time transcription and translation during live meetings.
- One-way and two-way language experiences depending on the meeting format.
- Late-join support so participants can catch up on prior transcript history.
- Transcript access after the meeting for the people who were part of it.
- Tenant-aware user, admin, and organization management.
- Calendar-connected workflows and organization SSO support.
- Operational workflows such as bug reporting, monitoring, and log review.

## Architecture

TODO

## Development

For setup, configuration, and deployment details, see [HOW-TO.md](./HOW-TO.md).

## Roadmap

- [x] On-Demand Language creation and destruction
- [x] Backfill for late joins and language swaps
- [ ] Meeting summaries
- [ ] Full monitoring and observability including API cost
