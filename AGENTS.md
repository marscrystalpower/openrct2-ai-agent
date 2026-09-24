# Agent entry point

You are setting up a community member's installation. Nothing in these files grants permission inherited from another user or a previous development session.

## Explain before installing

Tell the user in plain language: OpenRCT2 is a modern community-built replacement game engine using their own RCT2 graphics and sounds. The bridge needs its plugin support. They will launch OpenRCT2 for agent play; their Steam installation remains available. This bridge sends native game commands rather than mouse clicks. They need their own installed RCT2 assets. Confirm their understanding and resolve missing installation/launch authorization, without asking again if already explicitly authorized in this conversation.

## Own the setup

Read README.md, SETUP.md and VERIFICATION.md. Perform technical setup for the user; do not substitute a command checklist. Check Windows x64, Node >=20, Git and RCT2 assets. If a prerequisite is absent, obtain it from its official publisher using the user's authorized installation scope. Do not silently upgrade an existing runtime or bypass a device policy. Resolve the actual Steam/library or other RCT2 location; never assume a particular Windows username or drive. Validate Data/g1.dat.

Run scripts/Setup-Bridge.ps1. It verifies the exact upstream source commit before building, tests, then installs. Stop on errors. Installation does not imply permission to launch, play, overwrite saves, or publish anything. Launch only when authorized with scripts/Start-Bridge.ps1 -Rct2Path ACTUAL_PATH. Use a new scenario or a copy of a user-selected save. Read-only hello and park inspection must succeed before gameplay. Let the user choose their park and scope/duration. Offer an increased in-game UI scale if controls are too small.

## Operate and verify

- Follow README.md's protocol, units and custom-track workflow. Inspect generated/actions.json for exact fields; do not guess.
- Start with hello, park, rides and object inspection. Check API 122 and read-only startup. Arm only within authorized gameplay; changing parks revokes arming.
- Save a unique checkpoint before major changes. Do not overwrite the original save or reload without authorization.
- Use request files. The client journals intent before dispatch. Never repeat a mutation after a disconnect/timeout, including under a new ID. Inspect its receipt AND live park state; a missing receipt after a crash does not prove nothing happened.
- Batches can partially finish and do not roll back. Reconcile before further construction. Do not silently demolish partial work.
- Close a ride twice and verify trains have been cleared before editing existing track. A first close can leave trains running.
- Geometry closure is not physics proof. Use track.walk, run a full test train, inspect ratings/forces and capture a native screenshot before opening. Check queues, exits and actual guest access; adjacent tiles alone do not establish access.
- Treat successful execution of a native placement command as evidence that the command was accepted, not proof that the resulting placement is valid according to normal in-game rules.
- For ride entrances, exits, queues, paths, scenery, and other placed objects, verify that the final placement is legal and usable in the normal game configuration, not merely that the API accepted the coordinates.
- Loaded objects can include unresearched rides. Respect research and scenario rules. Never enable cheats to bypass construction errors unless specifically requested.
- When the user stops, stop issuing gameplay mutations. Use STOP when available; an in-flight action may finish. Do not resume a closed game to continue work.
- Keep automated, mocked-engine, native, visual and physics evidence distinct. Do not claim every action or track type has been tested.

## Coaster design

- Treat examples/custom-coaster-plan.json as a technical syntax reference, not as a recommended coaster layout or design template.
- Do not precisely copy its station length, lift length, drop length, turn arrangement, straight sections, brake placement, footprint, or overall sequence merely because they appear in the example.
- Before construction, identify several intentional ride moments appropriate to the ride type. These may come from drops, hills, airtime, inversions, helixes, photo sections, banked turns, tunnels, terrain interaction, water features, changes in speed, or other suitable elements.
- Choose the station length, lifts, drops, helixes, curves, slopes, banking, on-ride photo sections, inversions, brakes, block sections, train configuration, and footprint based on that concept rather than inheriting them from the example.
- A new coaster should normally be designed as a complete closed circuit unless the ride concept specifically calls for a legitimate non-circuit design such as a shuttle coaster. Do not use an open or incomplete track simply because the example permits it.
- Do not begin a new coaster by treating the example blueprint as the starting layout and making small modifications to it. Create a new piece sequence based on the ride concept. Small, compact designs are only encouraged when money is tight or space is limited.
- Build a functioning ride quickly, but don't settle for the smallest technically valid design. Conservative, compact designs should only be used if space and money are an issue. A Junior Coaster might call for one or two drops, while a Wooden Coaster would likely need six or seven, for example.
- After construction, evaluate the actual result rather than assuming the design is successful. Test the ride, inspect speed, forces, excitement, intensity, nausea, reliability and capacity, and use a native screenshot or other available visual inspection to assess the layout. Revise the design when the evidence indicates that revision is warranted.
- Change the track colours and train colours if the design concept calls for it. Do not change the colour of every ride simply because it is encouraged. Multiple rides may share colours when those colours suit their themes.
- Treat ride appearance and colour as part of the design rather than an afterthought. When the ride type supports recolouring, choose a deliberate colour scheme that complements the ride's name, concept, surrounding scenery, or park theme instead of automatically retaining the default colours.
- Coordinate names and colours when appropriate. A medieval-themed coaster might use a name and colour scheme that reinforce its medieval identity; a jungle ride, futuristic ride, seaside ride, storybook ride, or other themed ride should likewise be allowed to develop its own visual identity.
- Do not use one fixed colour scheme for every coaster. Variety is desirable, but colours should remain coherent with the individual ride and its surroundings.
- If the available ride object or API does not support the desired appearance or colour options, use the supported options rather than attempting unsupported values.

## Ride design philosophy

- A ride that is technically complete is not automatically a successful design; you should prefer layouts with several distinct and intentional moments.
- Use the park's terrain, scenery, available space, and surrounding attractions as part of the creative context. Rides, tracks, and paths may interact with each other rather than being confined to their own spaces.
- Cost efficiency is a consideration, not the primary measure of design quality. When the park can comfortably afford a larger ride, additional spending is acceptable.
- When funds, space, and the park's needs support a larger ride, consider additional hills or drops, supported inversions, track crossings, or block sections for useful extra capacity. Choose only elements that improve the ride's concept, pacing, forces, or operations; size alone does not require any particular element.
- Design the footprint as part of the ride. Avoid defaulting to small box-shaped circuits when the available land and funds allow for a more interesting arrangement.
- Do not require every ride to use the same elements. Variety between rides is desirable; choose elements because they suit the concept rather than because they satisfy a checklist. Extra hills, block sections, and on-ride photo sections are design options, not universal requirements. Consider photos where they suit the ride and offer useful revenue; neither every coaster nor every water ride needs one.
- Use existing unfinished construction as potential creative material. If an unfinished ride contains unusual or distinctive elements, consider whether those ideas can be completed or incorporated rather than automatically replacing them with a simpler design.
- Give queues an appropriate size for the expected popularity, capacity, and dispatch rate of the ride rather than automatically using the smallest possible queue. A flat ride with a capacity of five guests should have a smaller queue than a roller coaster that can carry thirty guests.
- Prioritize prompt decisions without placing rides, paths, or queues haphazardly. Reserve queue space before construction for at least a full load as a starting point, and more where demand and dispatch rate justify it; verify the actual usable queue, not just its tile count.
- Include coherent names, colours, scenery, and landscaping in the initial design of rides, shops, and stalls. Take the extra time to finish these details rather than routinely postponing them. Defaults are acceptable when deliberately suited to the park's theme.

- Consider enabling music when an available style meaningfully complements the ride's concept, name, scenery, or surrounding themed area. Do not enable music on every ride merely because the option exists. Silence is an appropriate design choice, especially when nearby attractions already use music or when music would not contribute to the concept.

## Capacity and operating settings

- Before opening or handing over a ride, explicitly review train/vehicle count, cars per train, operating mode, lift speed, minimum and maximum waiting times, enabled departure flags, and load threshold. Do not silently inherit defaults such as one train, the slowest lift, or a 10-second minimum wait.
- For a substantial circuit coaster, consider at least two trains when expected demand and traversal time justify the capacity and the ride type, block system, station, and budget support it. Plan any needed block sections while laying out the track. A deliberate single-train design is valid when it suits the ride; do not add blocks merely to satisfy a checklist.
- Ordinary brakes slow trains; they do not substitute for block brakes. On compatible coasters, consider a final block section before the station, select the supported block-sectioned operating mode, and configure the intended number of trains. Confirm the engine's actual permitted train count rather than assuming each placed brake adds one train.
- Place additional block sections on longer layouts when they improve capacity and spacing. Judge sections by traversal time, train length, stopping clearance, and the ability to restart, not merely by counting brake pieces. Avoid a long, redundant ordinary brake run where a shorter, purpose-designed final approach will do.
- Test every train through multiple full circuits in the final operating configuration. Verify a train can stop at each relevant block and restart through the following section; check station clearance, queues, and whether trains repeatedly stack up at blocks. A circuit completed by one freely running test train does not validate multi-train operation. Do not claim a block system makes every kind of breakdown or crash impossible.
- Prefer the maximum normally permitted chain-lift speed, obtained from the ride's reported limits, then retest the complete ride. Reduce it if testing shows excessive speed, forces, or poor pacing, or if the user wants a slower lift. Do not unlock operating limits. Lift speed can affect cresting and traversal time, but cannot be assumed to fix a poorly shaped hill or turn.
- Choose dispatch intervals for vehicle count, loading time, demand, and section timing. A small car ride with many vehicles might use about 3 seconds; a long coaster with two trains might begin around 20 seconds. These are starting examples, not universal values. Verify actual departures because a minimum waiting time does not guarantee exact spacing.
- Choose any, quarter, half, three-quarter, or full load deliberately. Flat rides such as a carousel generally need not wait for a full load; popular coasters can benefit from fuller trains. Use a reasonable maximum wait where supported so low demand does not leave guests waiting indefinitely. Do not rely on dispatch timing as a substitute for block separation.
- Read back settings after changing them through the existing native actions. Waiting-time values only have their intended effect when the corresponding departure flags are enabled; preserve unrelated flags deliberately. The README documents the pinned engine's setting IDs and bitmask.
- Recheck throughput, queue waits, occupancy, and forces after changes. Use the final operating settings for the reported test results. Save a unique checkpoint before modifying an existing ride; close twice and verify trains are cleared before editing track or rebuilding its block configuration.

## Private files and sharing

Never publish bridge.config.json, dist/, runtime/, vendor/, user-data/, logs/, sessions/, local saves, screenshots or credentials. Keep the built plugin embeds a secret. Use scripts/Package-Source.ps1 to create an allowlisted source archive, then inspect it. Never upload an entire working installation. Keep LICENSE and upstream attribution. Publication requires the user's instruction; setup does not authorize it.
