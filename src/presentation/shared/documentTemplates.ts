import type { TemplateId } from '../../domain/business/Business'

export const documentTemplates: { id: TemplateId; name: string; description: string }[] = [
  {
    "id": "classic",
    "name": "Classic",
    "description": "The current design. Serif branding and a clean ruled header."
  },
  {
    "id": "modern",
    "name": "Modern",
    "description": "A bold centered brand banner."
  },
  {
    "id": "compact",
    "name": "Compact",
    "description": "Tighter spacing for longer documents."
  },
  {
    "id": "minimal",
    "name": "Minimal",
    "description": "Quiet typography and generous white space."
  },
  {
    "id": "executive",
    "name": "Executive",
    "description": "A framed letterhead with double rules."
  },
  {
    "id": "ledger",
    "name": "Ledger",
    "description": "Structured grid lines inspired by accounting books."
  },
  {
    "id": "ribbon",
    "name": "Ribbon",
    "description": "A strong brand ribbon and highlighted total."
  },
  {
    "id": "editorial",
    "name": "Editorial",
    "description": "Large serif branding and a refined masthead."
  },
  {
    "id": "outlined",
    "name": "Outlined",
    "description": "Framed customer details and rounded table borders."
  },
  {
    "id": "sidebar",
    "name": "Accent rail",
    "description": "A vertical brand rail with offset content."
  }
]
