# Smart Wheel Chair UI/UX Redesign Plan

Date: 2026-07-12  
Status: Planning only. No replacement implementation should happen until this plan is approved.  
Target: A new experimental UI that can be reviewed beside the current app without changing the existing rider/operator pages.

## 1. What Happened To The Previous Experiment

The previous `/experiments` prototype was deleted because it looked too plain and did not feel premium enough for a Smart Wheel Chair system.

Removed:

- `webapp/app/experiments/page.tsx`
- The `/experiments` link in `webapp/app/page.tsx`
- The empty `webapp/app/experiments` route folder

This new document is the design plan before the next experiment is coded.

## 2. Product Feeling

The new UI should not feel like a simple admin dashboard.

It should feel like:

- A premium smart mobility operating system.
- A live safety and rental command center.
- A calm, trustworthy rider experience for a mobility-aid product.
- A fast, dense, professional operator cockpit for fleet staff.
- A real product interface, not a marketing page.

The main visual signal should be the live wheelchair fleet: map, telemetry, chair state, safety status, rental state, and commands.

## 3. Core Design Name

Working concept name:

`SmartWheel Pulse`

Meaning:

- `SmartWheel`: clear product identity.
- `Pulse`: live telemetry, safety heartbeat, movement, and real-time fleet awareness.

## 4. Non-Negotiable Design Rules

1. The experimental UI must be separate from the current UI.
2. It must reuse the real backend paths and data hooks.
3. It must not rewrite firmware, Supabase functions, database logic, or command semantics.
4. It must be responsive from mobile to large desktop.
5. It must be keyboard accessible.
6. It must feel premium, smooth, and intentionally designed.
7. It must use real operational surfaces, not empty decorative cards.
8. It must avoid a boring single-color theme.
9. It must keep commands clear and safe.
10. It must be easy to approve or reject without touching the current app.

## 5. Proposed Route Structure

The next experiment should use multiple experiment routes instead of one overcrowded page.

```txt
webapp/app/experiments/
  layout.tsx
  page.tsx
  rider/page.tsx
  operator/page.tsx
  components/
    ExperimentShell.tsx
    BrandMark.tsx
    ModeTabs.tsx
    LiveMapStage.tsx
    DeviceMarkerLegend.tsx
    FleetRail.tsx
    FleetRow.tsx
    DeviceHeroPanel.tsx
    DeviceVitalsGrid.tsx
    StatusPill.tsx
    SafetyTimeline.tsx
    RiderRidePanel.tsx
    RiderPlanSelector.tsx
    RiderWalletPanel.tsx
    RiderSafetyDock.tsx
    OperatorCommandDeck.tsx
    OperatorFleetMetrics.tsx
    OperatorOtaPanel.tsx
    CommandButton.tsx
    EmptyState.tsx
    LoadingState.tsx
  hooks/
    useExperimentWallet.ts
    useSelectedDevice.ts
    useCommandDispatcher.ts
    useRentalActions.ts
  styles/
    tokens.ts
```

Route behavior:

- `/experiments`
  - Not a marketing landing page.
  - A polished mode launcher with live fleet preview.
  - Shows two large choices: Rider Experience and Operator Cockpit.
  - Also shows current live health summary from `useFleetState`.

- `/experiments/rider`
  - Fully usable rider rental experience.
  - Uses the same real rental create API and payment webhook.
  - Shows available chairs, wallet, rental plans, active rental timer, SOS, and cancel/end session.

- `/experiments/operator`
  - Fully usable operator command cockpit.
  - Uses the same `commands` table and realtime fleet data.
  - Shows fleet list, full map, selected device details, command deck, events, safety alerts, and OTA status.

## 6. Visual Direction

### 6.1 Overall Mood

The design should combine:

- Deep cinematic map surfaces.
- Clean medical-grade panels.
- Sharp industrial controls.
- Warm confidence, not cold sci-fi.
- Clear emergency states.

It should look more like a high-end mobility operations product than a generic SaaS dashboard.

### 6.2 Color System

Use a mixed, disciplined palette:

```txt
Core Ink          #05070A   Main dark map/shell background
Graphite          #111827   Dark panels and nav rails
Soft Clinical     #F7F7F2   Light rider surfaces
Warm Surface      #EFE7DA   Secondary warm neutral
Electric Cyan     #00A7B5   GPS, selected state, realtime signal
Mobility Blue     #2563EB   Primary app action
Safety Green      #10B981   Online, safe, inside geofence
Signal Amber      #F59E0B   Warning, expiry, caution
Emergency Red     #EF4444   SOS, fall, tamper, critical
Violet Accent     #7C3AED   OTA/firmware only, not dominant
Text Strong       #0F172A   Main text on light surfaces
Text Muted        #64748B   Secondary text
Border Light      #D7DEE8   Light panel borders
Border Dark       #263241   Dark panel borders
```

Important:

- Do not make the whole UI beige.
- Do not make the whole UI dark blue.
- Do not make it a purple gradient app.
- Use color as state language.
- Emergency colors must be immediately visible.

### 6.3 Typography

Use the current app font stack unless font loading is changed later.

Type scale:

```txt
Display title        32-44px desktop, 26-32px mobile
Page title           24-30px desktop, 22-26px mobile
Section title        13px uppercase, 0.14em tracking
Body                 14-16px
Dense metadata       11-12px
Command button       13-15px, bold
Telemetry numbers    24-40px, heavy
```

Rules:

- No viewport-width font scaling.
- No negative letter spacing.
- Big type only where the screen deserves it.
- Dense cockpit panels should use compact headings.

### 6.4 Shape And Spacing

```txt
Main panel radius       8px
Small control radius    6px
Button height           44px minimum
Icon button             40px minimum
Grid gap desktop        12-16px
Grid gap mobile         10-12px
Rail width desktop      320-360px
Command deck desktop    380-440px
```

Rules:

- No nested cards inside cards.
- Repeated items can be cards.
- Major page sections should feel like panels/docks, not floating marketing cards.
- Hover/focus states must not shift layout.

## 7. Main Experience Layouts

## 7.1 Experiment Home

Purpose:

Let the user choose which future UI to test while seeing real fleet status.

Desktop wireframe:

```txt
┌────────────────────────────────────────────────────────────────────────────┐
│ SmartWheel Pulse                      Current App: Rider | Operator        │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────┐ ┌──────────────────────────┐ ┌─────────────┐ │
│ │ Rider Experience          │ │ Operator Cockpit          │ │ Live Health │ │
│ │ Big visual ride preview   │ │ Map command preview       │ │ Online      │ │
│ │ Rent, wallet, safety      │ │ Fleet, alerts, commands   │ │ Alerts      │ │
│ │ [Open Rider Experiment]   │ │ [Open Operator Experiment]│ │ Active      │ │
│ └──────────────────────────┘ └──────────────────────────┘ └─────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Mobile:

```txt
SmartWheel Pulse
[Rider Experience]
[Operator Cockpit]
[Live Health Summary]
```

## 7.2 Rider Experiment

The rider flow should feel calm, direct, and premium.

Main desktop layout:

```txt
┌────────────────────────────────────────────────────────────────────────────┐
│ SmartWheel Pulse                       Wallet 150 SAR | Operator | Current │
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌───────────────────────────────────────┐ │
│ │ Nearby Chairs                │ │ Live Map Stage                         │ │
│ │ - WCHAIR-001 Ready           │ │ selected chair marker + geofence       │ │
│ │ - WCHAIR-002 Charging        │ │ route/safety halo                      │ │
│ │ - WCHAIR-003 Offline         │ └───────────────────────────────────────┘ │
│ │                              │ ┌───────────────────────────────────────┐ │
│ │ Filters: Ready, Near, Safe   │ │ Ride Control Sheet                     │ │
│ └──────────────────────────────┘ │ chair summary, plans, unlock, SOS      │ │
│                                  └───────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

Mobile rider layout:

```txt
┌────────────────────────────┐
│ Top bar: SmartWheel Wallet │
├────────────────────────────┤
│ Map 45vh                   │
│ selected marker            │
├────────────────────────────┤
│ Bottom ride sheet          │
│ chair status               │
│ plans                      │
│ unlock / cancel / SOS      │
└────────────────────────────┘
```

Rider visual highlights:

- Large active rental timer when a ride is active.
- Animated but subtle countdown ring.
- Chair status strip with battery, distance if available, lock state, geofence state.
- Clear rental plan selector.
- SOS button always reachable but visually separated.
- Wallet top-up is secondary, not the main visual focus.

Rider states:

```txt
No chair selected:
  show map + nearby chair list + helpful empty state

Chair selected:
  show chair hero, battery, safety status, rental plans

Payment/rental pending:
  disable duplicate actions, show progress stepper

Rental active:
  show timer, active chair, cancel/end, SOS, lock status

Rental ending:
  show "locking chair" state until command is queued

Error:
  show visible recovery message, do not hide active rental
```

## 7.3 Operator Experiment

The operator flow should be denser and more powerful.

Desktop operator layout:

```txt
┌────────────────────────────────────────────────────────────────────────────┐
│ SmartWheel Pulse | Fleet Health | Alerts | Active Rentals | Search         │
├───────────────┬──────────────────────────────────────────┬────────────────┤
│ Fleet Rail     │ Full Live Map Stage                      │ Command Deck    │
│ status groups  │ selected chair, geofence, safety zones   │ selected chair  │
│ search/filter  │ live marker animation                    │ lock/power/SOS  │
│ device rows    │ bottom telemetry ribbon                  │ speed/geofence  │
│                │                                          │ OTA summary     │
├───────────────┴──────────────────────────────────────────┴────────────────┤
│ Safety Timeline: fall, tamper, geofence, OTA, session events               │
└────────────────────────────────────────────────────────────────────────────┘
```

Mobile operator layout:

```txt
┌────────────────────────────┐
│ Top bar + fleet health     │
├────────────────────────────┤
│ Segmented tabs             │
│ Map | Fleet | Commands     │
├────────────────────────────┤
│ Tab content                │
└────────────────────────────┘
```

Operator visual highlights:

- Map remains the main stage on desktop.
- Fleet rail rows are dense but polished.
- Selected chair gets a dramatic detail dock.
- Emergency states interrupt the normal layout with a strong alert band.
- OTA is visible but not louder than safety.
- Command buttons use icons and clear state labels.

Operator states:

```txt
Normal:
  selected chair detail, command deck, telemetry, recent events

Offline selected:
  commands disabled where unsafe, last seen emphasized

Emergency:
  red alert band, location, clear SOS, recent event context

Tamper:
  lock/tamper state highlighted, clear tamper action

Geofence breach:
  map ring red, distance from boundary, geofence controls

OTA active:
  progress strip, target version, last error if present
```

## 8. Component Plan

## 8.1 Shared Experiment Components

### `ExperimentShell`

Responsibility:

- Page chrome for experiment routes.
- Header, current-app links, route switcher, responsive container.

Props:

```ts
type ExperimentShellProps = {
  mode: 'home' | 'rider' | 'operator';
  children: React.ReactNode;
};
```

### `BrandMark`

Responsibility:

- Product identity.
- Compact icon plus `SmartWheel Pulse`.

Visual:

- Dark square icon.
- Cyan signal line.
- Text lockup.

### `ModeTabs`

Responsibility:

- Switch between Rider Experiment and Operator Experiment.
- On desktop: top-right segmented control.
- On mobile: full-width tabs below header.

### `LiveMapStage`

Responsibility:

- Wrap existing `Map` component in a premium stage.
- Add overlay for selected chair, status, map legend, and telemetry ribbon.

Uses:

```ts
import Map from '../../../components/Map';
```

Props:

```ts
type LiveMapStageProps = {
  devices: DeviceState[];
  selectedId: string | null;
  onSelectDevice: (id: string) => void;
  density: 'rider' | 'operator';
};
```

### `StatusPill`

Responsibility:

- Consistent state color language.
- Online, offline, ready, active, warning, emergency, OTA.

Props:

```ts
type StatusTone =
  | 'ready'
  | 'active'
  | 'offline'
  | 'warning'
  | 'critical'
  | 'ota'
  | 'neutral';
```

### `DeviceVitalsGrid`

Responsibility:

- Battery, speed, motor temp, tilt, RSSI, uptime.
- Desktop: 3 columns or ribbon.
- Mobile: horizontal scroll or 2-column grid.

## 8.2 Rider Components

### `RiderRidePanel`

Responsibility:

- Main rider action surface.
- Shows selected chair, safety status, rental plans, active rental timer.

States:

- `idle`
- `selected`
- `renting`
- `active`
- `ending`
- `error`

### `RiderPlanSelector`

Responsibility:

- Shows rental plan options.
- Must be visually richer than simple cards.
- Each plan should show time, price, and ideal use.

Plan design:

```txt
Quick Ride     1 min    Free       Try / demo
City Errand    15 min   5 SAR      Short trip
Full Hour      60 min   10 SAR     Longer mobility
```

### `RiderWalletPanel`

Responsibility:

- Shows local simulated wallet.
- Top-up action.
- Not connected to real payment storage beyond the current app behavior.

### `RiderSafetyDock`

Responsibility:

- Persistent SOS access.
- Shows geofence and chair safety state.
- Mobile: sticky bottom small emergency control.

## 8.3 Operator Components

### `FleetRail`

Responsibility:

- Search/filter/sort device list.
- Group by critical, active, ready, offline.
- Keyboard navigable rows.

Filters:

```txt
All
Critical
Active
Ready
Offline
OTA
```

### `FleetRow`

Responsibility:

- Compact row with ID, status, last seen, battery, speed, alert marker.
- Must have role/button semantics if rendered as div; button preferred.

### `DeviceHeroPanel`

Responsibility:

- Strong selected-chair summary.
- ID, status, last seen, uptime, lock state, power state.

### `OperatorCommandDeck`

Responsibility:

- Lock/unlock.
- Power on/off.
- SOS/clear SOS.
- Clear tamper.
- Speed limit.
- Geofence.
- OTA summary link/panel.

Safety rules:

- Disable commands when no chair is selected.
- Show clear text when a command is queued.
- Do not hide command failures.
- Dangerous commands must be visually separated.

### `OperatorFleetMetrics`

Responsibility:

- Online count.
- Active rentals.
- Critical alerts.
- Average battery.
- OTA in progress.

### `SafetyTimeline`

Responsibility:

- Last 30 events from `events`.
- Color-coded by severity.
- Shows wheelchair ID, event type, age, and important detail preview.

## 9. Data And Backend Wiring

No backend rewrite is planned.

The experiment must reuse:

```txt
useFleetState()
  device_state
  events
  Supabase realtime

/api/rentals/create
  creates reserved rental

/api/payments/webhook
  activates rental and queues unlock flow

supabase.from('commands').insert(...)
  operator and rider commands
```

## 9.1 Device Selection

Hook:

```ts
function useSelectedDevice(deviceStates: DeviceState[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedDevice = useMemo(
    () => deviceStates.find((device) => device.wheelchair_id === selectedId) ?? null,
    [deviceStates, selectedId]
  );

  useEffect(() => {
    if (!selectedId && deviceStates.length > 0) {
      setSelectedId(deviceStates[0].wheelchair_id);
    }
  }, [deviceStates, selectedId]);

  return { selectedId, selectedDevice, setSelectedId };
}
```

## 9.2 Command Dispatcher

Hook:

```ts
function useCommandDispatcher(selectedId: string | null) {
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  async function sendCommand(cmd: string, args: Record<string, unknown> = {}) {
    if (!selectedId) throw new Error('Select a wheelchair first.');

    setPendingCommand(cmd);
    setCommandError(null);

    const { error } = await supabase.from('commands').insert({
      wheelchair_id: selectedId,
      cmd,
      args,
      status: 'pending',
      req_id: `exp-${cmd.toLowerCase()}-${Date.now()}`
    });

    setPendingCommand(null);

    if (error) {
      setCommandError(error.message);
      throw error;
    }
  }

  return { sendCommand, pendingCommand, commandError };
}
```

## 9.3 Rental Actions

Hook:

```ts
function useRentalActions(selectedId: string | null, walletBalance: number) {
  async function startRental(durationMinutes: number, priceSar: number) {
    if (!selectedId) throw new Error('Select a wheelchair first.');
    if (walletBalance < priceSar) throw new Error('Insufficient wallet balance.');

    const createResponse = await fetch('/api/rentals/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wheelchair_id: selectedId,
        duration_s: durationMinutes * 60
      })
    });

    const createPayload = await createResponse.json();
    if (!createResponse.ok) throw new Error(createPayload.error || 'Failed to create rental.');

    const paymentResponse = await fetch('/api/payments/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'mock',
        rental_id: createPayload.rental.id,
        amount: priceSar * 100,
        provider_ref: `EXP-${Date.now()}`
      })
    });

    const paymentPayload = await paymentResponse.json();
    if (!paymentResponse.ok) {
      await supabase
        .from('rentals')
        .update({ state: 'cancelled' })
        .eq('id', createPayload.rental.id)
        .eq('state', 'reserved');

      throw new Error(paymentPayload.error || 'Payment failed.');
    }

    return createPayload.rental;
  }

  return { startRental };
}
```

## 10. Motion And Interaction Plan

Motion should make the product feel alive, not noisy.

Allowed motion:

- Page route fade/slide: 160-220ms.
- Panel entrance: opacity + translateY only.
- Selected marker pulse on map.
- Command queued pulse.
- Active rental timer ring.
- Alert band slide-in.
- Skeleton shimmer during loading.

Avoid:

- Big bouncing cards.
- Constant background animation.
- Large blur effects on every frame.
- Layout-shifting hover states.
- Motion that hides command state.

Framer Motion rules:

```txt
Use transform and opacity.
Keep transitions under 250ms for controls.
Use prefers-reduced-motion fallback.
Do not animate large map containers.
```

## 11. Responsive Rules

Breakpoints:

```txt
Mobile       < 768px
Tablet       768px - 1023px
Desktop      1024px - 1439px
Wide         >= 1440px
```

Rider mobile:

- Map at top, 42-48vh.
- Ride panel as bottom sheet.
- Chair list collapses into horizontal carousel or drawer.
- SOS always visible.

Operator mobile:

- Use tabs: Map, Fleet, Commands, Events.
- No three-column cramped layout.
- Command buttons stay 44px minimum.
- Fleet rows stay readable.

Desktop:

- Operator should use a real cockpit layout.
- Rider should feel spacious and premium.
- Map should be visually dominant.

Wide desktop:

- Keep max content width to avoid huge stretched panels.
- Map can expand, rails keep stable widths.

## 12. Accessibility Plan

This matters more because the product is for mobility support.

Requirements:

- All clickable rows are real `button` elements where possible.
- If a `div` must be interactive, add `role="button"`, `tabIndex={0}`, and keyboard handling.
- Visible focus ring on every command.
- Minimum 44px touch targets.
- Color is never the only status indicator.
- SOS labels must be text plus icon.
- Avoid tiny text in mobile command surfaces.
- Support reduced motion.
- Alert messages use readable text, not only icons.

## 13. Visual Detail Ideas

## 13.1 Map Stage

The map should not sit like a plain rectangle.

Design:

- Full dark map.
- Thin cyan selected-device ring.
- Geofence circle visible.
- Alert state turns selected marker and ring red.
- Bottom telemetry strip overlays the map on desktop.
- On mobile, telemetry strip becomes compact chips.

## 13.2 Device Status Language

```txt
Ready          Blue/cyan       Locked, online, rentable
Active         Green           Unlocked/session active
Offline        Gray            Last seen emphasized
Warning        Amber           Expiring/geofence near/OTA deferred
Critical       Red             SOS/fall/tamper/geofence breach
OTA            Violet          Firmware update state only
```

## 13.3 Operator Command Design

Command deck should feel like real controls:

- Lock/unlock: primary large command.
- Power: secondary.
- SOS: isolated danger action.
- Speed/geofence: sliders with current values and apply button.
- OTA: version status, progress, target version.

No command should be hidden in a dropdown if it is safety-critical.

## 13.4 Rider Design

Rider experience should feel softer:

- Calm light panels.
- Large selected chair summary.
- Friendly rental plans.
- Clear total price.
- Timer after rental starts.
- Safety dock visible but not scary unless needed.

## 14. Implementation Phases

## Phase 1: Recreate Experiment Skeleton

Files:

```txt
webapp/app/experiments/layout.tsx
webapp/app/experiments/page.tsx
webapp/app/experiments/rider/page.tsx
webapp/app/experiments/operator/page.tsx
webapp/app/experiments/components/ExperimentShell.tsx
webapp/app/experiments/components/BrandMark.tsx
webapp/app/experiments/components/ModeTabs.tsx
webapp/app/experiments/styles/tokens.ts
```

Goal:

- Build the shell only.
- Add links from home page only after the shell looks acceptable.

Verification:

```txt
tsc --noEmit
npm.cmd run build
browser screenshot desktop
browser screenshot mobile
```

## Phase 2: Shared Live Data Components

Files:

```txt
LiveMapStage.tsx
FleetRail.tsx
FleetRow.tsx
StatusPill.tsx
DeviceVitalsGrid.tsx
useSelectedDevice.ts
```

Goal:

- Render live fleet state beautifully.
- No command actions yet.
- Confirm map, selected chair, and rows work.

## Phase 3: Rider Experiment

Files:

```txt
RiderRidePanel.tsx
RiderPlanSelector.tsx
RiderWalletPanel.tsx
RiderSafetyDock.tsx
useExperimentWallet.ts
useRentalActions.ts
```

Goal:

- Fully usable rental flow.
- Active timer.
- Cancel/end command path.
- SOS command path.

## Phase 4: Operator Experiment

Files:

```txt
OperatorCommandDeck.tsx
OperatorFleetMetrics.tsx
OperatorOtaPanel.tsx
SafetyTimeline.tsx
useCommandDispatcher.ts
```

Goal:

- Fully usable command cockpit.
- Lock/unlock, power, SOS, clear tamper.
- Speed limit and geofence command controls.
- Events and OTA status display.

## Phase 5: Responsive And Motion Polish

Goal:

- Mobile rider feels like a real app.
- Mobile operator uses tabs, not cramped columns.
- Desktop operator feels like a command center.
- Motion is smooth and restrained.

Checks:

```txt
375x812 mobile
768x1024 tablet
1280x720 desktop
1440x900 wide desktop
```

## Phase 6: Approval Build

Commands:

```txt
cd webapp
.\node_modules\.bin\tsc.cmd --noEmit
npm.cmd run build
```

Optional:

```txt
npm.cmd run lint
```

Lint is not the approval gate unless unrelated repo-wide lint debt is separately accepted.

## 15. What Will Not Be Changed

The redesign should not change:

- Firmware logic.
- SNTP/time sync.
- Supabase edge function business logic.
- Database schema.
- Existing `/rider` page.
- Existing `/operator` page.
- Existing `Map` behavior unless a visual wrapper is needed.
- Command names or args.
- Payment webhook contract.

## 16. Approval Checklist

Before replacing the existing UI, the experiment must pass this checklist:

Visual:

- Looks premium and not boring.
- Map is visually dominant where appropriate.
- Rider and operator screens feel intentionally different.
- Status colors are clear.
- Emergency state is obvious.
- No overlapping text.
- No awkward mobile layout.

Functional:

- Uses live `device_state`.
- Uses live `events`.
- Selects chairs from map and list.
- Rental creation works.
- Payment webhook path works.
- Commands queue to Supabase.
- Active rental timer works.
- Errors are visible.

Accessibility:

- Keyboard reachable.
- Focus states visible.
- Touch targets large enough.
- SOS is text-labeled.
- Reduced-motion safe.

Build:

- TypeScript passes.
- Production build passes.
- Browser visual check passes on desktop and mobile.

## 17. First Visual Direction To Approve

Recommended direction:

`Premium Live Mobility OS`

Summary:

- Dark cinematic map in the center.
- Light clinical rider panels.
- Dark professional operator command deck.
- Cyan for live GPS and selected state.
- Green for safe/active.
- Amber for caution.
- Red for emergency.
- Violet only for OTA.
- Dense operator cockpit on desktop.
- Bottom-sheet rider app on mobile.

This direction should look much stronger than the deleted experiment because it gives each role a real product identity instead of one generic dashboard.

## 18. Decision Needed Before Coding

Please approve one of these directions:

```txt
A. Premium Live Mobility OS
   Best for serious smart wheelchair operations.

B. Luxury Rider First
   Softer, more consumer-app feeling, with operator secondary.

C. Emergency Command Center
   More dramatic, safety-first, strongest for fleet monitoring.
```

My recommendation is:

`A. Premium Live Mobility OS`

It balances beauty, trust, safety, and real operational usefulness.
