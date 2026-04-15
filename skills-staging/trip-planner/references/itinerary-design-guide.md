# Itinerary HTML Design Guide

## Design System: Romantic Lavender (Default)

The trip-planner produces interactive HTML itineraries using the established design system from Ishrat's engagement trip. This document describes the visual and structural conventions.

### Color Palette (CSS Variables)
```css
--bg-main: #FAF7FC;           /* Page background */
--bg-card: rgba(255,255,255,0.85);
--text-main: #3D2E4A;         /* Primary text */
--text-muted: #7E6B8A;        /* Secondary text */
--purple-deep: #5A4763;       /* Headers, emphasis */
--purple-mid: #8B7394;        /* Labels, accents */
--lavender: #C4B0D0;          /* Decorative elements */
--gold: #C4A87A;              /* Divider lines, highlights */
--rose: #C48A9A;              /* Warm accents */
```

### Typography
- Serif: 'Cormorant Garamond' -- headings, day titles, restaurant names
- Sans: 'Nunito Sans' -- body text, descriptions, labels
- Script: 'Great Vibes' -- hero names, romantic flourishes
- Script Alt: 'Dancing Script' -- pet names, subtitles

### Required Sections (in order)
1. **Hero** -- Trip title, traveler names, dates, decorative heart frame
2. **Flights** -- Inbound/outbound cards with airport codes, times, seat info
3. **Timeline** -- Collapsible day cards with events, maps, tags
4. **To-Do List** -- Interactive pre-trip checklist with toggle checkmarks
5. **Dining Guide** -- Grid of restaurant cards with cuisine, address, day assignment
6. **Notes** -- Practical tips (jet lag, weather, logistics)
7. **Footer** -- Closing flourish
8. **Journal FAB** -- Floating button + modal for trip journaling

### Day Card Structure
```html
<div class="day-card" onclick="toggleCard(this)">
  <div class="day-header">
    <span class="day-label">Day N • Weekday, Mon DD</span>
    <h3 class="day-title">Evocative Title</h3>
  </div>
  <div class="day-body">
    <div class="event-list">
      <!-- Events go here -->
    </div>
    <div class="day-map" id="mapN"></div>
  </div>
</div>
```

### Event Structure
```html
<div class="event">
  <div class="event-time">HH:MM AM/PM</div>
  <div class="event-details">
    <strong>Event Title</strong>
    <div class="event-desc">Description text</div>
    <div class="event-addr">Full street address, City, State ZIP</div>
    <span class="tag tag-TYPE">Label</span>
    <div class="event-tip">Optional tip in italic</div>
  </div>
</div>
```

### Tag Types
- `tag-travel` -- Transport, driving, flights (lavender)
- `tag-dine` -- Restaurants, meals, desserts (gold)
- `tag-event` -- Shopping, entertainment, appointments (rose)
- `tag-rest` -- Nature, leisure, spa, rest (soft purple)

### Address Lines
Every venue MUST have an `event-addr` line with full street address and ZIP code.
```css
.event-addr { font-size: 0.78rem; color: var(--purple-light); margin-top: 0.35rem; }
.event-addr::before { content: '◈ '; font-size: 0.6rem; opacity: 0.6; }
```

### Dining Cards
```html
<div class="dining-card">
  <div class="dining-name">Restaurant Name</div>
  <div class="dining-cuisine">CUISINE TYPE</div>
  <div class="dining-loc">Area • Drive Time</div>
  <div class="dining-addr">Full Address</div>
  <div class="dining-for">Day N — Occasion</div>
</div>
```

### Maps (Leaflet.js)
Each day card includes an embedded Leaflet map with pin markers for all stops.
```javascript
dayStops = {
  map1: [[lat, lng, 'Label'], ...],
  // ...
};
```

### Budget Section (NEW for trip-planner)
When budget tracking is enabled, add after the Dining Guide:
```html
<section>
  <div class="section-header">
    <div class="overline">Financial</div>
    <h2>Trip Budget</h2>
  </div>
  <!-- Budget summary cards: per-day estimates, category breakdown, running total -->
</section>
```

### Responsive Design
- All grids collapse to single-column below 600px
- Flight cards stack vertically on mobile
- Day maps maintain 220px height across breakpoints
- Font sizes use clamp() for hero text
