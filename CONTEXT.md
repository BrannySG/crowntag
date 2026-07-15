# Crown Tag

Real-time multiplayer web arena game: continuous drop-in/out crown tag across parallel arenas.

## Language

**Arena**:
One live parallel instance of continuous Crown Tag play — its own Fighters, Crown, Scores, and join capacity. No discrete rounds; people drop in and out while it runs.
_Avoid_: Room, Match, Game, Lobby, Instance

**Player**:
A human-controlled participant in an Arena. Has a Display Name, can hold the Crown, and accrues arena-session Score.
_Avoid_: User, Client

**Bot**:
A server-driven Arena participant that fills toward Cap. Can hold the Crown and score like a Player. To other humans it is indistinguishable in presentation from a Player (convincing Display Name, same body/avatar); internally it remains a Bot.
_Avoid_: NPC, AI, Dummy, Fake player

**Fighter**:
A Player or Bot present in an Arena — anyone who can move, Hit, hold the Crown, and score.
_Avoid_: Actor, Entity, Contender, Occupant, Participant

**Display Name**:
The name shown for a Fighter in-world and on the Leaderboard. Every Fighter has one; Bots use convincing human-like names.
_Avoid_: Username, Handle, Nick (unless referring to the join prompt text)

**Cap**:
Maximum Fighters allowed in one Arena at once (default 12, config-tweakable).
_Avoid_: Limit, Max players, Slot count

**Crown**:
The single contested object in an Arena. At any moment it is either held by one Fighter or sitting unheld at Crown Spawn. Holding it is what accrues Score.
_Avoid_: Flag, Ball, Objective, Token, Pickup

**Holder**:
The Fighter currently holding the Crown. At most one per Arena; when the Crown is at Crown Spawn there is no Holder. A role, not a separate kind of Fighter.
_Avoid_: King, Carrier, Bearer, Tagged

**Hit**:
One successful click-to-hit contact from a Fighter onto another Fighter in range. Exactly two outcomes: Steal if the target is the Holder; otherwise Stun and Knockback. No HP or multi-hit combos in V1.
_Avoid_: Attack, Shot, Tag, Melee

**Steal**:
Hit outcome against the Holder: the Crown transfers to the hitter, who becomes the new Holder. No Stun or Knockback on Steal in V1.

**Grace**:
Brief period after a Fighter becomes Holder (via Claim or Steal) during which Steal cannot transfer the Crown. Duration is config-tweakable; exact numbers are not part of the glossary.

**Stun**:
Brief movement lock applied to a non-Holder hit by a Hit. Duration is config-tweakable; exact numbers are not part of the glossary.

**Knockback**:
Impulse that pushes a non-Holder away from the hitter on the same Hit that applies Stun. Strength is config-tweakable; exact numbers are not part of the glossary.

**Score**:
A Fighter's arena-session total of Crown hold-time. Resets when that Fighter leaves the Arena; not persistent across Arenas or visits.
_Avoid_: Points, Elo, Rank (as the raw total), Lifetime score

**Leaderboard**:
On-screen ranking of Fighters in the current Arena by Score (including Bots).
_Avoid_: Scoreboard, Standings, Ladder

**Join**:
A Player entering an Arena via name-then-go auto-match (no arena browser or room codes in V1).

**Disconnect**:
A Player leaving the Arena (network drop or quit). If they were Holder, the Crown returns to Crown Spawn. Their Score for that visit ends.
_Avoid_: Leave, Quit (as the domain event name — fine as UI copy)

**Crown Spawn**:
The fixed place in the Arena where an unheld Crown sits — including after the Holder Disconnects.
_Avoid_: Base, Home, Flag stand

**Claim**:
Becoming Holder of an unheld Crown by entering proximity / touching it. No click required. Distinct from Steal (which is a Hit on the Holder).
_Avoid_: Pickup, Grab, Collect

**Fighter Spawn**:
A designated Join point in the Arena where a Player appears. Separate from Crown Spawn so a Join does not instantly Claim. An Arena may have more than one.
_Avoid_: Respawn, Start, Entry (as the place name)
