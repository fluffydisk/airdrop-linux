---
{
  "name": "Airdrop desktop",
  "description": "A quiet, legible Linux workspace for local sharing.",
  "colors": {
    "dark-bg": "#191c21",
    "dark-sidebar": "#14171b",
    "dark-surface": "#22262d",
    "dark-surface-hover": "#303640",
    "dark-border": "#454d59",
    "dark-text": "#edf0f5",
    "dark-muted": "#bcc4d0",
    "dark-subtle": "#aab5c5",
    "dark-accent-strong": "#b3ceff",
    "dark-accent-ink": "#142b55",
    "dark-accent-tint": "#263b5c",
    "dark-green": "#87d5ad",
    "dark-error": "#ffaaa4",
    "dark-accent": "#91b8ff",
    "light-bg": "#f6f7f9",
    "light-sidebar": "#eceff3",
    "light-surface": "#fff",
    "light-surface-hover": "#e3e8ef",
    "light-border": "#b9c2cf",
    "light-text": "#202b3b",
    "light-muted": "#4e5b6e",
    "light-subtle": "#5c6879",
    "light-accent-strong": "#17479f",
    "light-accent-ink": "#fff",
    "light-accent-tint": "#e5edfc",
    "light-green": "#226b48",
    "light-error": "#ae302d",
    "light-accent": "#245ac3",
    "dark-purple-accent": "#c2a4fa",
    "dark-purple-accent-strong": "#d8c3ff",
    "dark-purple-accent-ink": "#291447",
    "dark-purple-accent-tint": "#3c2b50",
    "light-purple-accent": "#7139a8",
    "light-purple-accent-strong": "#542780",
    "light-purple-accent-ink": "#fff",
    "light-purple-accent-tint": "#f1e8fc",
    "dark-green-accent": "#8ddbb7",
    "dark-green-accent-strong": "#a8ebcc",
    "dark-green-accent-ink": "#103724",
    "dark-green-accent-tint": "#254234",
    "light-green-accent": "#216c4a",
    "light-green-accent-strong": "#155336",
    "light-green-accent-ink": "#fff",
    "light-green-accent-tint": "#e2f2e9",
    "dark-orange-accent": "#f4bc89",
    "dark-orange-accent-strong": "#ffd0a6",
    "dark-orange-accent-ink": "#40220b",
    "dark-orange-accent-tint": "#4b3425",
    "light-orange-accent": "#97480d",
    "light-orange-accent-strong": "#773606",
    "light-orange-accent-ink": "#fff",
    "light-orange-accent-tint": "#fff0e2"
  },
  "typography": {
    "headline": {
      "fontSize": "28px",
      "fontWeight": 650,
      "lineHeight": 1.25,
      "letterSpacing": "-0.5px",
      "fontFamily": "system-ui, sans-serif"
    },
    "title": {
      "fontSize": "17px",
      "fontWeight": 600,
      "lineHeight": 1.5,
      "fontFamily": "system-ui, sans-serif"
    },
    "body": {
      "fontSize": "14px",
      "fontWeight": 400,
      "lineHeight": 1.5,
      "fontFamily": "system-ui, sans-serif"
    },
    "label": {
      "fontSize": "13px",
      "fontWeight": 550,
      "lineHeight": 1.4,
      "fontFamily": "system-ui, sans-serif"
    },
    "support": {
      "fontSize": "12px",
      "fontWeight": 400,
      "lineHeight": 1.5,
      "fontFamily": "system-ui, sans-serif"
    }
  },
  "rounded": {
    "small": "4px",
    "control": "6px",
    "surface": "8px",
    "connection": "10px",
    "dialog": "12px"
  },
  "spacing": {
    "space-1": "4px",
    "space-2": "8px",
    "space-3": "12px",
    "space-4": "16px",
    "space-6": "24px",
    "space-8": "32px"
  },
  "components": {
    "button-primary": {
      "backgroundColor": "{colors.dark-accent}",
      "textColor": "{colors.dark-accent-ink}",
      "rounded": "{rounded.control}",
      "padding": "8px 14px",
      "typography": "{typography.label}"
    },
    "button-secondary": {
      "backgroundColor": "{colors.dark-surface}",
      "textColor": "{colors.dark-text}",
      "rounded": "{rounded.control}",
      "padding": "8px 14px",
      "typography": "{typography.label}"
    },
    "button-text": {
      "textColor": "{colors.dark-accent}",
      "rounded": "{rounded.control}",
      "padding": "8px"
    },
    "input": {
      "backgroundColor": "{colors.dark-bg}",
      "textColor": "{colors.dark-text}",
      "rounded": "{rounded.control}",
      "padding": "10px 12px"
    },
    "navigation-selected": {
      "backgroundColor": "{colors.dark-accent-tint}",
      "textColor": "{colors.dark-accent}",
      "rounded": "{rounded.surface}",
      "padding": "11px 12px"
    },
    "count": {
      "textColor": "{colors.dark-muted}",
      "rounded": "{rounded.small}",
      "padding": "1px 6px"
    },
    "settings-card": {
      "backgroundColor": "{colors.dark-surface}",
      "textColor": "{colors.dark-text}",
      "rounded": "{rounded.surface}",
      "padding": "24px"
    }
  }
}
---

# Design System: Airdrop desktop

## Overview

**Creative North Star: "A quiet, legible Linux workspace"**

A quiet, legible Linux workspace. Task clarity and familiar controls carry the identity: Airdrop's paper plane, restrained blue actions, ruled groups, and readable system type. Technical-publication discipline informs headings and annotations without imitating a terminal.

This system describes the Electron desktop application. The separate mobile PWA retains its existing presentation. Light and dark themes use semantic foreground/background pairs; purple, green, and orange are user-selected accent alternatives.

**Key Characteristics:**
- Paper-plane identity and restrained action color.
- Readable task headings, ruled groups, and predictable alignment.
- Text accompanies status color; keyboard focus remains visible.

The retained direction record is `seed:b5a0b9c26ed2e811`, candidate 5 (technical publication). THESIS: sharing tasks remain immediately legible. OWN-WORLD: Airdrop's paper plane and restrained blue, expressed as a Linux workspace. FORM: semantic themes, ruled groups, readable system type, and a consistent SVG vocabulary. The user's explicit autonomy and native-desktop constraints govern this direction.

## Colors

### Primary
The default blue accent marks primary actions, links, selected navigation, and file symbols. Accent ink supplies the contrasting foreground; accent strong is the primary-button hover state; accent tint is a restrained selection surface. Frontmatter components show the root dark baseline. At runtime, semantic CSS variables select the matching light or dark pair and the user's chosen accent.

### Secondary
Purple, green, and orange are alternate action palettes selected in preferences, not concurrent decorative accents. Each has its own accent, strong, ink, and tint pair in both themes.

### Neutral
Background, sidebar, surface, and surface hover establish quiet layers. Text, muted, and subtle distinguish content from supporting annotations and placeholders. Border defines group boundaries. Green and error identify successful and failed states, accompanied by text.

**The Semantic Pair Rule.** Use each theme's matching foreground and background roles together, including the selected accent's ink and tint.

## Typography

**Body and heading font:** system-ui, sans-serif. No remote fonts or UI dependencies.

The hierarchy is compact and familiar: headline for page headings; title for section headings; body for content; label for controls; support for short annotations. The frontmatter records the reused roles. Paragraphs use a more open line height (1.6). The sharing-region heading is (20px); queue headings are (15px). Navigation uses medium weight (500). The brand uses (21px) at the widest layout. No separate display face is introduced.

## Layout

The shell combines a fixed sidebar with a flexible workspace. Sidebar width is (192px), reducing to (164px) at (900px) and (136px) at (700px). The main content caps at (1120px), with padding stepping from (32px) to (24px) to (20px). Topbar minimum height is (64px). The spacing primitives are recorded in frontmatter; component-specific padding also uses observed intermediate steps.

At (700px), preferences become one column, address controls stack, and the send bar wraps. The (760px) breakpoint reduces connection-control width and adjusts connection steps. Navigation keeps its labels. Dialogs scroll within (90vh); the shared explorer has its own responsive grid and a (480px) breakpoint. Compact density reduces file-row and settings-card padding.

The first surface follows destination → file action → transfer state → optional guest access. Settings starts with Updates; connection and advanced configuration use disclosures. This is the current surface composition, not a prohibition on future surfaces.

## Elevation & Depth

Ordinary surfaces use tone and single-pixel borders. Shadows are reserved for dialogs and the explorer context menu. Exact shadow values live in the sidecar; dialogs also use a dimmed backdrop. There is no general floating-card treatment.

**The Quiet Surface Rule.** Use borders and tonal layers for ordinary groups; reserve elevation for overlays.

## Shapes

Controls use the control radius; containers and selected navigation use the surface radius. Small counters and keyboard hints use the small radius. Connection fields use the connection radius, while dialogs use the dialog radius. The shared explorer retains some specialized geometry: its dialog radius is (16px), and breadcrumb buttons inherit the shared button radius (9px). File symbols use inline SVG shapes; status dots and spinners are circular.

## Components

### Buttons
Primary buttons use accent with accent ink; hover shifts to accent strong. Secondary buttons use surface and text; hover shifts to surface hover. Text buttons use accent on a transparent background and tint on hover. Primary and secondary controls have a minimum height of (38px). Disabled buttons reduce opacity to (0.5) and use the default cursor. Focus uses an accent outline (2px) offset by (3px). Background and color transitions take (150ms).

### Inputs / Fields
Fields use background, text, border, and the control radius, with subtle placeholders and the shared focus treatment. Connection-link fields have the connection radius. The clipboard field is vertically resizable with a minimum height of (240px).

### Navigation
Labeled icon buttons use muted text at rest and text on surface hover. Selection uses accent on tint. The desktop SVG vocabulary is reused by the shared explorer through an optional icon adapter; mobile defaults remain unchanged. Navigation moves keyboard focus to the active view heading.

### Counters
Small outlined counts use tabular numerals and support-size text. They communicate quantity rather than an action.

### Cards / Containers
Settings cards use a surface fill, single-pixel border, surface radius, and (24px) padding, reduced to (18px) in compact or narrow layouts. The queue uses the same surface with ruled file rows and a separated send bar. The drop region uses a dashed border, surface fill, and a minimum height of (250px); active drag uses accent border and tint.

### Status and overlays
Result panels distinguish pending, error, and success with text plus semantic color. Update discovery, download, installation, and completion remain separate visible states; package-manager instructions do not imply installation. Connection progress uses labeled steps and a spinner. OS reduced-motion preferences and the in-app setting disable transitions and animations. Dialog content scrolls when needed.

## Do's and Don'ts

### Do:
- Do use semantic theme pairs for text, actions, selection, and surfaces.
- Do preserve the paper-plane identity and familiar blue default.
- Do retain navigation labels as the window narrows.
- Do pair state color with descriptive text and honor reduced motion.

### Don't:
- Don't introduce gradients or translucent panels into the desktop workspace.
- Don't use decorative hero typography or oversized decoration to displace task controls.
- Don't change mobile styles to implement a desktop design adjustment.
