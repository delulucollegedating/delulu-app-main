---
name: emil-design-eng
description: Encodes Emil Kowalski's design engineering philosophy for UI/UX polish, micro-interactions, animation decisions, button feedback, and interface craft.
---

# Design Engineering (Emil Kowalski Philosophy)

## Core Philosophy

1. **Unseen details compound**: Subdued borders, active states, exact custom easing curves, proper origins.
2. **Beauty is leverage**: Interfaces that look and feel stunning win trust and drive engagement.

## Key Rules & Framework

### 1. Button Press & Active States
Pressable elements must feel responsive. Always add subtle active press feedback:
```css
.btn-press {
  transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background-color 160ms ease, box-shadow 160ms ease;
}
.btn-press:active {
  transform: scale(0.96);
}
```

### 2. Enter Animations: Never scale(0)
Always animate from `scale(0.95)` with `opacity: 0` to `scale(1)` with `opacity: 1`.

### 3. Custom Easing & Speed
- Enter: `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out)
- UI Duration: Keep interaction transitions between 120ms and 250ms.
- Never use `ease-in` for entering elements or dropdowns.

### 4. Glassmorphism & Depth
- Layered backdrop blurs (`backdrop-blur-md`, `backdrop-blur-xl`).
- Semi-transparent subtle borders (`border-white/10` or `border-outline-variant/30`).
- Multi-layered subtle shadows instead of harsh solid outlines.
