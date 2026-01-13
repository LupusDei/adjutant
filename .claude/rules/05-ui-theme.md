# UI Theme Rules

## Required: Use frontend-design Skill

**Always invoke the `frontend-design` skill for UI/frontend work.**

When working on any task involving:
- React components (`frontend/src/components/**/*.tsx`)
- Styles and CSS (`frontend/src/styles/`, component CSS)
- Visual design, layout, or aesthetics
- Animations, effects, or micro-interactions
- Typography, colors, or theme changes

Use: `/frontend-design <description of the UI task>`

This skill provides design thinking, aesthetic guidelines, and ensures
production-grade implementations that avoid generic "AI slop" styling.

**Example:**
```
/frontend-design Create a status indicator component with Pip-Boy styling
```

## Pip-Boy Aesthetic

The UI should evoke the Fallout Pip-Boy terminal:
- Monochrome green phosphor display
- CRT scanline effects
- Retro-futuristic typography
- Chunky, industrial controls

## Color Palette

```css
--pipboy-green: #00ff00       /* Primary text/elements */
--pipboy-green-dim: #00aa00   /* Secondary/inactive */
--pipboy-green-glow: #00ff0066 /* Glow effects */
--pipboy-bg: #0a0a0a          /* Dark background */
--pipboy-bg-panel: #111111    /* Panel backgrounds */
```

## Typography

- Use monospace fonts (e.g., `VT323`, `Share Tech Mono`, or system monospace)
- Uppercase for headers and labels
- Slight text-shadow for glow effect

## Visual Effects

1. **Scanlines**: Subtle horizontal lines overlay (CSS pseudo-element)
2. **CRT Curvature**: Optional slight border-radius on main frame
3. **Flicker**: Subtle opacity animation on boot/transitions
4. **Glow**: Box-shadow on active elements

## Component Styling

- **Buttons**: Bordered rectangles with hover glow
- **Lists**: No bullets, use `>` prefix or highlight bar
- **Inputs**: Simple bordered boxes, green caret
- **Scrollbars**: Thin, styled to match theme

## Animations

- Keep at 60fps (performance is a constitution principle)
- Use CSS transitions for simple state changes
- Use `transform` and `opacity` for GPU acceleration
- Avoid animating layout properties (width, height, margin)

## Accessibility

- Maintain sufficient contrast (green on dark)
- Support keyboard navigation
- Don't rely solely on color for state indication
