# Dangler labels — vault snippets, 2026-08-02

Labelling stage of [074-resolved-referent-annotation](wayfinder/tickets/074-resolved-referent-annotation.md),
prerequisite for its model-resolved-referent annotation. The labelled set 072 called for.
Done by agents (six parallel labelers), ruled by Micah 2026-08-02.

## Method

- Vault root: `./vault` (default `ELICIT_VAULT_ROOT`). Snippets: `vault/snippets/<id>/v1.md`.
- Population: all 139 snippets. Every one is `kind: unprompted` (imported prose) from 19
  `post-*` transcripts. **No snippet in this vault has an eliciting question** — every
  `Provenance.question` is empty — so the question-anaphora population ticket 072 worried
  about is not represented here; the measurement below is prose-anaphora only.
- Source location: snippet body located in its transcript by exact-substring search, earliest
  matching user turn wins (ticket 024/073 mechanism). Verified for all 139 (no misses).
- Context window: the mechanical `Provenance.context` rule from ticket 073 —
  up to 2 sentences immediately preceding the cut in the source turn, split on
  `. ` / `! ` / `? ` + uppercase; empty when the cut opens its turn (18 snippets).
  Computed deterministically before labelling; matches `extractContext` in
  `src/harvester/harvester.ts`.
- Judgment rule (ticket 072 definition): a dangling reference is a pronoun, demonstrative,
  or definite description whose referent is NOT identifiable from the snippet text alone.
  Judged conservatively: expletive "it" ("It became clear to me"), discourse-opener
  "This/It" that the rest of the snippet resolves, first-person I/we, generic "you",
  in-snippet relative pronouns, and proper nouns are NOT danglers (see the measured
  warning at `src/harvester/admissibility.ts` ~line 229: a leading-pronoun structural
  check shredded 25 of 139 keeps on this same corpus).
- Sources, in the table's last column:
  - `same-turn context` — the referent is recoverable from the 2-preceding-sentences
    window (what ticket 073 would stamp as `Provenance.context`).
  - `eliciting question` — referent recoverable only from `Provenance.question`.
    **Never fires in this vault** (no questions exist).
  - `unresolvable` — referent not in the window and no question; includes referents
    locatable only further back in the piece (marked "(beyond window)" in the referent
    column) and referents not locatable anywhere in the source.
- Three post-labelling audit corrections by the parent (conservative direction):
  `01KZ0WPJ5WWR7V8HJ6YVX0B8SK` (self-resolving "the research"), and the two checklist
  snippets (`01KZ0WPJ5R2VYJQXXH33ATHW7N`, `01KZ0WPJ5RXF91A0RCAY4ZZBQB`) whose
  "the collective"/"the project" are generic addressees of a published checklist
  (generic-you class), not specific referents. `01KZ0WPJ4XZR1G403AVQ7F6F9G`
  ("anyone else") is an indefinite quantifier, not a definite description.

## Table

| Snippet | Dangles | Dangling expression | Resolved referent | Source |
|---|---|---|---|---|
| 01KZ0WPJ539XVS9S6BHVX9T85P | yes | the same problem | (beyond window) the problem of letting people with collections put large zoomable, annotatable images online with notes — elaborated later in the same turn | unresolvable |
| 01KZ0WPJ53F8RXWCXKBX5JTYVT | yes | those four parts | (beyond window) the four pipeline parts named in the previous turn: serving the image, making the manifest, storing the annotations, hosting the result | unresolvable |
| 01KZ0WPJ54Z0Q612H4WAXBJZ1J | yes | that folder | the folder of static HTML/JSON/media files that publishing produces | same-turn context |
| 01KZ0WPJ53V8WTH0DAACWXKQR0 | yes | the same objects | the media objects in the Archie web app | same-turn context |
| 01KZ0WPJ53Y6AM0WFP7T1VZT1D | yes | each of them | the people with collections named in the window: the 70-year-old collector and the dargahs group | same-turn context |
| 01KZ0WPJ53C145GX47GCSBJH6H | yes | this | the thing each of them wanted — putting a large image online, zooming into it, annotating it, and keeping the note | same-turn context |
| 01KZ0WPJ54NZTM01CD9ZEJ0VAT | no | — | — | — |
| 01KZ0WPJ53W6AX603Y8NWK8GZF | yes | the four years; the problem | (beyond window) the four years (c. 2020–2024) of picking at the image-hosting/annotation problem for people with collections | unresolvable |
| 01KZ0WPJ53RPWM1REKGGNV2AEB | yes | the answer; this | the answer to the image-hosting problem, shaped like the collective's self-hosted approach | same-turn context |
| 01KZ0WPJ2RJ7W9HNAFD8FBRWEY | yes | seminar 2; the project | (beyond window) the Bidar-wide mesh network project; seminar 2 = a programme seminar (neither named in window; piece-only) | unresolvable |
| 01KZ0WPJ2SNR2Z0GJ4EGDZ49A2 | no | — | — | — |
| 01KZ0WPJ2TZ7JXD9M1AYXV73MQ | no | — | — | — |
| 01KZ0WPJ2KYCBVJZRV0CCETZGG | yes | the capstone | (beyond window) the author's Srishti capstone (this paper) | unresolvable |
| 01KZ0WPJ2SXJZXVES7Y3V00DNG | yes | the collective | (beyond window) the collective(s) under discussion (DB, DLL — the collectives the author is part of) | unresolvable |
| 01KZ0WPJ2QR32VXBG8X8XHA9Q9 | no | — | — | — |
| 01KZ0WPJ2STBQBPNZ5T9HVD8EJ | no | — | — | — |
| 01KZ0WPJ2PNY7YG199RKS052HP | no | — | — | — |
| 01KZ0WPJ2SHQ7DCYYCAMEZ2KWS | yes | it | the voluntary, no-deadline, share-and-sustain way of working described by Thomson's quote | same-turn context |
| 01KZ0WPJ2SWZYRXJQVG1Y6SC1T | yes | the honour system | the honour-system principle of the fund-disbursal app I made | same-turn context |
| 01KZ0WPJ2SZEJV0QRZZ6XH90TT | yes | this | the alternative way of working (the voluntary approach just described) | same-turn context |
| 01KZ0WPJ2NA5F7G77CYH6GD8TG | yes | the outcomes, outputs, practices and reflection | the multiple smaller outcomes, outputs, practices and reflections produced by the capstone-as-object (named in the window) | same-turn context |
| 01KZ0WPJ2PT4MFWKCZJVQZYVPR | no | — | — | — |
| 01KZ0WPJ2R4B0GXHR018WH67YM | yes | the workshop | (beyond window) the participatory annotation workshop with the Kumbhara women and Ruksana ma'am | unresolvable |
| 01KZ0WPJ2PHRH7H1FHV22TYNRB | yes | him; the groups; the activities | Naveen, the workshop facilitator (named in the window) (also: the groups → the workshop's participant groups; the activities → the workshop's planned community-participation activities) | same-turn context |
| 01KZ0WPJ2SJ0602ZQW0CB2WR1J | yes | the "top management"; the collaborators | the collaborators and (non-opaque) 'top management' of the interlinked collectives (DLL named in the window) | same-turn context |
| 01KZ0WPJ2TW1CTTA799KBVEQVQ | yes | these newer networked practices; their stand | (beyond window) the care practices of the collectives under discussion (DB, DLL) and their stand against hegemony | unresolvable |
| 01KZ0WPJ2S17Q1R60EMNAD06AS | yes | these beliefs | the honour-system beliefs described in the window (volunteers assume accountability; shared understanding of being part of something fragile) | same-turn context |
| 01KZ0WPJ2PY0KSC7SEPWM0GW4A | no | — | — | — |
| 01KZ0WPJ2P9SS3HHGC3240RC9Z | no | — | — | — |
| 01KZ0WPJ2P4NG70F0GGRYGT58D | yes | It | the potter's offer to teach us / the learning exchange with the Kumbhara potter (his welcoming words to learners are in the window) | same-turn context |
| 01KZ0WPJ2QSA0TTJS1TAB9GSPA | yes | the workshop | (beyond window) the studio workshop Naveen facilitated in Bidar (the meta-facilitation workshop) | unresolvable |
| 01KZ0WPJ2SCD5A29Z7KN7KB1Y1 | yes | these networks | (beyond window) the collectives under discussion (the voluntary working group whose viability is being doubted) | unresolvable |
| 01KZ0WPJ2QPHJX69VJAWQPJXJB | yes | her | Ruksana ma'am, the Urdu author whose work is being translated (the other member of 'both of us' in the window) | same-turn context |
| 01KZ0WPJ2QJBM59EYTFF22BDAX | yes | her | Ruksana ma'am, the Urdu author whose work is being translated ('her prose' in the window) | same-turn context |
| 01KZ0WPJ2SX0GRTQANR692Y7Y1 | yes | these connections | the connections that the actants and the networks have among each other and with other enabling institutions (named in the window) | same-turn context |
| 01KZ0WPJ2NKF2MJA30Q9ZZFS4W | yes | this capstone | (beyond window) the author's capstone project, introduced at the opening of the source turn ("I wanted to do the capstone not as a single thesis or problem-solution") | unresolvable |
| 01KZ0WPJ2SC8KSF34TH28DX84J | yes | That | the fact that Naveen had to "de-sanskritise" my translation output because it was too formal (named in the window) | same-turn context |
| 01KZ0WPJ2QY4ESBMJCT4F8PSM9 | no | — | — | — |
| 01KZ0WPJ2RWK6VKRYS4SEP42T7 | yes | the task | the collaborative task of producing and constantly revising COVID19 myth-buster content (the gifs Thomson started) — its purpose is described in the window | same-turn context |
| 01KZ0WPJ2S0246WM96Z95CR288 | yes | This | the ongoing work of constantly updating and verifying the COVID-19 Pune app (named in the window) | same-turn context |
| 01KZ0WPJ2QGJ3M5FFBTSTR7E67 | yes | the children | (beyond window) the school children (8th–9th standard) at the school where Supriya is headmistress, with whom I led a workshop | unresolvable |
| 01KZ0WPJ2RRA83QEF7BZ47C89Q | yes | this; the numbers data | the choropleth map of Pune/PCMC COVID cases I was building — the window's shapefile/wards/QGIS content identifies the map-making (also: the numbers data → the daily COVID case counts the map was to display, beyond window) | same-turn context |
| 01KZ0WPJ2R9MQZ4SX26VG1QMW6 | yes | the word | the particular word from Ruksana ma'am's Urdu text being translated, whose meaning I confirmed with her in Hindi (the window describes the confirming process) | same-turn context |
| 01KZ0WPJ2QBWCMXAA0BV8C55XS | yes | the workshop | the workshop (Naveen's meta-facilitation studio workshop in Bidar) where I was facilitator for a few days and part of shaping it — described in the window | same-turn context |
| 01KZ0WPJ2Q1S8HZWBAGBD80S8B | no | — | — | — |
| 01KZ0WPJ2R85NPX95DWMST5X55 | yes | it | the rough spreadsheet I made for tracking DB's workflow (named in the window) | same-turn context |
| 01KZ0WPJ2N7R8N9A3QEWW7ENRB | yes | these networks | the networks of care practice I participated in — 'networks' (where care practitioners take on archetypal roles) is mentioned in the window | same-turn context |
| 01KZ0WPJ2S9YEGHFRJ3SBAN2GY | yes | these identities | the many different identities (of people, collectives, institutions) that the connections are linkages between — named in the window | same-turn context |
| 01KZ0WPJ2Q2ZRVH42X1YAMC3JH | yes | This | Naveen's point that being part of the workshop for all its good and bad implications is okay (stated in the window) | same-turn context |
| 01KZ0WPJ2PQAXNW18ZS9Y2B0A6 | yes | the work; this way | the capstone research/paper being structured, and the juxtaposition-based (non-linear) structure it uses — both recoverable from the window's 'this research' and its description of juxtaposition | same-turn context |
| 01KZ0WPJ2S9H134XFWGGGWDAGE | yes | that | the collaboration with the Viral Kindness group on the Pune map as a shared collaborative object (described in the window) | same-turn context |
| 01KZ0WPJ2SKDYFAS9825G9QH1N | yes | the differences | the differences between formal and informal language, surfaced by Naveen's 'de-sanskritising' — named in the window | same-turn context |
| 01KZ0WPJ2RWHM597TH224VMP21 | yes | The experience | the experience of translating Ruksana ma'am's Urdu work (confirming meanings in Hindi, word nuances, translation choices) — described in the window | same-turn context |
| 01KZ0WPJ2PACD23D4VYNFZJ50Z | yes | it | the process of moulding the diya — the gentle, mudra-like hand movements the potter showed us (named in the window) | same-turn context |
| 01KZ0WPJ2RTSJKDJSXDJWRYZDG | yes | this point | the point in the second annotation workshop when the Kumbhara women were making things and responding through speech and song (described in the window) | same-turn context |
| 01KZ0WPJ2PE58FAZQVFHWKEH0J | no | — | — | — |
| 01KZ0WPJ2Q0RQYZT91ZNMHTYRB | no | — | — | — |
| 01KZ0WPJ2RGA9YS8BA9TWTSD73 | yes | This | the work of personally gathering and checking the organisations' donation information for the Pune COVID resource spreadsheets (described in the window) | same-turn context |
| 01KZ0WPJ2RFF08J7PTM8WAAGCH | yes | ma'am | (beyond window) Ruksana ma'am, the Shayara whose Urdu work I was translating (introduced earlier in the same turn: "I also worked more closely with Ruksana ma'am-the Shayara") | unresolvable |
| 01KZ0WPJ2SM38E117VFG190BH8 | yes | these collectives | (beyond window) the care collectives the author worked with and described in the piece (Design Beku, DLL, Living Labs Network, Team YUVAA, ICAN, Viral Kindness) — the window merely presupposes them | unresolvable |
| 01KZ0WPJ2R2XA1M31VE52VX6T9 | yes | their bodies; the material | the workshop participants (the Kumbhara women) whose annotations came out in speech and song — referred to in the window (also: the material → the clay offered during the annotation workshop, beyond window) | same-turn context |
| 01KZ0WPJ2PCZCVEV5HAYTFZP39 | yes | it | the experience of making the diya with the Kumbhara potters (the gentle, mudra-like process) | same-turn context |
| 01KZ0WPJ2QPD5WR70VEJ9VRY0J | yes | this modularity | the modularity that text gives as an archiving medium (which audio lacks) | same-turn context |
| 01KZ0WPJ2N66XJ8A510B5C1975 | yes | the network | the network(s) the author be-ings in for the capstone (not separate from her) | same-turn context |
| 01KZ0WPJ2QP6C13FBJXSQR1VBN | yes | the conversation; the same thing | the conversations with students surfacing their own biases in the field (the same situation the author had struggled with in the past) | same-turn context |
| 01KZ0WPJ2RY4ZTAAC45N62YRYE | yes | the same information | the Pune COVID-19 resources information (hospitals, testing centres, organisations to donate to) collected in the sheets/app | same-turn context |
| 01KZ0WPJ2RWX2KM0QMYQFNJ3CJ | no | — | — | — |
| 01KZ0WPJ2TTDVEKZA5R4BWEXTZ | yes | it | (beyond window) the collective/network that breaks under its 'stand against' hegemony — the 'diseased' collective | unresolvable |
| 01KZ0WPJ2R7GJ9M2R4TBT141N6 | yes | the experience | the experience of translating Ruksana ma'am's Urdu work via Hindi to English | same-turn context |
| 01KZ0WPJ2P7G6QCHWVV617SCBZ | yes | the technology | the Servelots-Janasthu mobile internet-radio device (Raspberry Pi in the bull-grass pouch) | same-turn context |
| 01KZ0WPJ2P4Q8T2AK1BRE938RT | no | — | — | — |
| 01KZ0WPJ2SGSP8YRH2GHV9HD44 | yes | this | the struggle of separating the numbers data from the shape data for the Pune choropleth map | same-turn context |
| 01KZ0WPJ2S6Z3QRARW35EXNQX3 | yes | these collectives | the collectives (Design Beku, ICAN, etc.) where the counter-hegemonic translation/questioning practices occur | same-turn context |
| 01KZ0WPJ2TTK286235GQZPS6WJ | yes | the disease | the 'disease' of the collective — its fragility/breakage in a world that claims effectiveness | same-turn context |
| 01KZ0WPJ2QKDKRDQCKYMQ648QG | yes | it; the scaffolding | the workshop with the children at Supriya's school (also: the scaffolding → the workshop's participation structure the author designed, in the same turn beyond the window) | same-turn context |
| 01KZ0WPJ2R40FGWNMERCF2337C | yes | this translation | the translation of meaning/experience that participants require scaffolding to create (in participatory activities) | same-turn context |
| 01KZ0WPJ2PDVW882KF8Y8D4BFF | yes | the technology | the Servelots-Janasthu mobile internet-radio device (Raspberry Pi in the bull-grass pouch) | same-turn context |
| 01KZ0WPJ2SBX7GK5YP9F1SPVYJ | yes | these collectives; the network | the networks/collectives the paper describes (Design Beku, DLL, LLN, Team YUVAA) | same-turn context |
| 01KZ0WPJ2NN1BS6AGFPN3B9KHY | yes | those networks | the networks the author participated in during the post-COVID part of the capstone | same-turn context |
| 01KZ0WPJ2SHA55FCCDV5T6HYA5 | yes | that point | the point when the choropleth-map struggle and the lockdown emotional toll had exhausted the author | same-turn context |
| 01KZ0WPJ2RSG115X6063TKMYFF | no | — | — | — |
| 01KZ0WPJ2RFC75N2764ZGA3G2N | yes | the activity | the annotation activity of the workshop (the second workshop being planned, where communities annotate practices) | same-turn context |
| 01KZ0WPJ2S4BBW7HVKB5J8JKWZ | yes | these networks; this fragility | the networks/collectives the paper describes (Design Beku, DLL, LLN, Team YUVAA); (also: this fragility → the core idea of fragility underlying these collectives) | same-turn context |
| 01KZ0WPJ2TMV0X31P5Y19XCNR6 | yes | these collectives | the collectives the paper discusses (the care-system collectives in the conclusion) | same-turn context |
| 01KZ0WPJ2REXHTSGSVM6QF5D3B | yes | that translation; the clay | the translation of meaning/experience between participants (also: the clay → the clay material offered at the annotation workshop, in the same turn beyond the window) | same-turn context |
| 01KZ0WPJ5R2VYJQXXH33ATHW7N | no | — | — | — |
| 01KZ0WPJ5RXF91A0RCAY4ZZBQB | no | — | — | — |
| 01KZ0WPJ4YP3BQJXC760M7FAC4 | yes | the place | no referent locatable in source (the place whose community mesh would be infrastructure is never named) | unresolvable |
| 01KZ0WPJ4XMY8X4V22E4PH8DXB | no | — | — | — |
| 01KZ0WPJ4XATS07M5136HXAMYD | yes | there | the Global South (the place whose people the author wanted to listen to, named in the window) | same-turn context |
| 01KZ0WPJ4XZ7BX8GPB108TEXWR | no | — | — | — |
| 01KZ0WPJ5DP2M6GN2NF2FC63TF | no | — | — | — |
| 01KZ0WPJ5DV9T1T39FDYSYN2EZ | yes | these viewing experiences | the viewing experiences of the archives listed as examples on the IIIF apps/demos page | same-turn context |
| 01KZ0WPJ5DH0M1K2GS9HQMMQK5 | yes | it | the dense topic — the IIIF standard implementation I was reading up about | same-turn context |
| 01KZ0WPJ5DMRD5J3N9NHPHBPHG | no | — | — | — |
| 01KZ0WPJ5DDVEAQB92NYP65VM1 | yes | it | the dense topic — the IIIF standard implementation | same-turn context |
| 01KZ0WPJ5DGFT0Q0E985XGK1RN | yes | that time | the period when I was reading up on and trying to learn IIIF | same-turn context |
| 01KZ0WPJ5DQTEDF7F4J8ADBHAY | yes | it | Cantaloupe, the IIIF image server | same-turn context |
| 01KZ0WPJ5D5JBQX3FXNPWFY3QD | no | — | — | — |
| 01KZ0WPJ5D5HFB8CPN01WGSWZN | yes | that; it | creating the map in the Compost.mag piece with OpenSeadragon+Annotorious (the panable, zoomable, annotable image process) | same-turn context |
| 01KZ0WPJ5DVQFHP0HF30H2JV70 | yes | it | the process of creating a panable, zoomable, annotable image experience | same-turn context |
| 01KZ0WPJ4XVJ86K24317EDF4NW | yes | his; him | Chalapathi (a person the author pays every two months, named in the window) | same-turn context |
| 01KZ0WPJ4XZR1G403AVQ7F6F9G | no | — | — | — |
| 01KZ0WPJ5WWR7V8HJ6YVX0B8SK | no | — | — | — |
| 01KZ0WPJ4VR58XDR38KYZFHAZF | yes | them | (beyond window) the adivasis of Kerala (the Paniyas) — the community whose disenfranchisement the blog documents | unresolvable |
| 01KZ0WPJ4W167ZX408FJFZC6MZ | no | — | — | — |
| 01KZ0WPJ4WPYTG5BKRE60NVSFR | no | — | — | — |
| 01KZ0WPJ4WSD2FPC64YWG7NBMW | yes | them | the Paniyas (named in the window: 'After reading the histories of the Paniyas') | same-turn context |
| 01KZ0WPJ4WMJXPTDAMFVDQW6B3 | no | — | — | — |
| 01KZ0WPJ57QPJ8B39KH25KDFG1 | no | — | — | — |
| 01KZ0WPJ58837WYMHW22Q2K0XZ | no | — | — | — |
| 01KZ0WPJ58CF8MJ5VDY43FRSKK | yes | the root channel; the linkages | the canonical are.na channel added to config.json (also: the linkages → the hyperlinking between Are.na channels) | same-turn context |
| 01KZ0WPJ58MVY4X04GCZB731TG | no | — | — | — |
| 01KZ0WPJ58ZX932FN5SZWVH1G3 | no | — | — | — |
| 01KZ0WPJ58ZGHG231X7T6X52D8 | no | — | — | — |
| 01KZ0WPJ52ZWFTBMTVCDCDHZ24 | yes | these platforms | (beyond window) the digital platforms discussed earlier in the piece (YouTube, Amazon, E-ink retail signage) | unresolvable |
| 01KZ0WPJ52P2EAJPTXS7D6146B | no | — | — | — |
| 01KZ0WPJ52SJFF4JSK7CB8MVZ0 | yes | it | the content served by algorithmic convenience (the lightspeed, personally-targeted content; 'algorithmic convenience' named in the window) | same-turn context |
| 01KZ0WPJ52X6Q8B8T1F1W2RXFA | yes | the interface | the archival/annotable interface for the recorded conversations (recording-and-replay scenario established in the window) | same-turn context |
| 01KZ0WPJ51QXC0SNYEE35BJM9V | no | — | — | — |
| 01KZ0WPJ51ETMGMDGKFMYSA7BV | no | — | — | — |
| 01KZ0WPJ51YZQ5RXXTPKHPRC5V | yes | the E-ink signage | (beyond window) the E-ink dynamic price signage for brick-and-mortar retail, introduced at the start of the turn | unresolvable |
| 01KZ0WPJ518Y17E3WHNS0ED48W | yes | there | the platform (Amazon) with opaque, unrecordable prices that the window describes | same-turn context |
| 01KZ0WPJ51KQJ647PT9FMAWRV0 | no | — | — | — |
| 01KZ0WPJ52WRKNX5126QEY2GJY | yes | the iceberg; they | the hidden mass of the platform's manipulative architecture (the iceberg below the waterline, built on the window's river/swimming metaphor); (also: they → the users) | same-turn context |
| 01KZ0WPJ5S77XM071PMHTHDSFQ | yes | this Pilot; the archive | no referent locatable in source (the Pilot programme and the archive are never named in the turn or transcript) | unresolvable |
| 01KZ0WPJ5XSVS7GRZMGQX4KMVK | no | — | — | — |
| 01KZ0WPJ5RGFE70JQBGSA7NMQB | no | — | — | — |
| 01KZ0WPJ5WKCM01Y1W10KFNBHW | yes | the artisans; the production process | no referent locatable in source (the specific artisans and production process behind the redesigned products are never named) | unresolvable |
| 01KZ0WPJ5R2T9J815ZJT6XJSWS | no | — | — | — |
| 01KZ0WPJ5RME9X5B523GWT2M6Q | yes | the programme | the Kishori Film Festival (KiFi) programme (named in the window) | same-turn context |
| 01KZ0WPJ5R70487WM6XZAPC9T8 | yes | it; the participants | the Kishori Film Festival (KiFi) programme and its participants (the 11th-grade young women), named and identified in the window | same-turn context |
| 01KZ0WPJ5S31P75RC640PSY5J4 | no | — | — | — |
| 01KZ0WPJ5Q2P5YH3N66WEY5J9K | yes | the design; the audio fragment cards | (beyond window) the Papad tool redesign and its audio-fragment cards (the oral-knowledge tool described in the piece's opening) | unresolvable |
| 01KZ0WPJ5QRT4HZNF9Y99FE95H | yes | the community | (beyond window) the community Papad serves — villagers on the Tumkur and Channapatna community networks | unresolvable |
| 01KZ0WPJ5QTMG9TG5B7P49HWYV | no | — | — | — |
| 01KZ0WPJ5Q4FRXYX42YM1AV65S | yes | the Channapatna team; the development team at Janastu | (beyond window) the Channapatna Papad deployment team (Design Beku, Maya, Community Health Navigators) and the Janastu development team | unresolvable |
| 01KZ0WPJ5QFJ4T2WMH2GS6FMJW | yes | both teams | (beyond window) the Channapatna Papad team and the Janastu development team (named earlier in the same turn) | unresolvable |
| 01KZ0WPJ5WVCYC84EZRTD3JWZV | no | — | — | — |

## Summary

| Measure | Count |
|---|---|
| Total snippets | 139 |
| Danglers | 96 |
| Resolvable by context window (ticket 073, 2 preceding sentences) | 71 |
| Resolvable only by eliciting question | 0 |
| Unresolvable | 25 |

Dangler rate: 96/139 = 69.1%. Of danglers, 71/96 = 74.0% are resolvable from the
2-preceding-sentences window alone; 25/96 = 26.0% are not (referents beyond the window,
or nowhere locatable). The eliciting-question bucket is 0 by construction — this vault
has no conversational snippets, so ticket 072's question-anaphora split is unmeasured here.

Population split (per session): see table column order — the heaviest dangler density is
in `post-blog-carefull-collectives-and-their-care-practices` (61 of its 76 snippets dangle),
matching the "imported prose dangles via prose-anaphora" expectation.
