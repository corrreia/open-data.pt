# The Card4B MYINFO operators

Four publishers — Barraqueiro Oeste, Boa Viagem, Ribatejana and MARE — whose timetables and stop
networks all live on one platform. Card4B's MYINFO is a multi-tenant deployment: each operator is a
folder under `https://myinfo.4cloud.pt`, with the same pages and the same shapes.

One page covers them because there is one integration. Each of them is still their own publisher key
in `publishers.ts`: they made the data, Card4B only hosts it.

## Source

The `myinfo` library (`packages/gatekeeper-shared/src/sources/myinfo/`), eight feeds of two kinds: one
`network` feed per operator — every stop with its position and the lines that call there — and a
`timetable` feed per origin-and-destination pair worth publishing. An operator's public portal is
`https://myinfo.4cloud.pt/IP/MotorBusca/<Operator>/`.

## Access

Public, no credentials, but the allowlist is unusual: because every operator shares one origin,
`deployment.ts` allowlists **folders** rather than hosts, in `MYINFO_OPERATORS`
(`BarraqueiroOeste,BoaViagem,Ribatejana,mare`). Adding an operator is one name there, one publisher
key, and its example feeds.

## Quirks

The landing page carries the whole stop network inline — Barraqueiro Oeste's is 2.3 MB — so the
library reads pages under a 12 MB cap and search answers under 4 MB, and one collection assembles at
most 8 MB before the policy's own source cap applies.

More operators run on MYINFO than we read: about a dozen Portuguese bus operators use it. Each new one
is only worth adding if the data is really theirs to publish and the operator is a publisher we can
name.
