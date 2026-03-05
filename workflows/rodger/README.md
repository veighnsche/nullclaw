# rodger workflows

Product-scoped workflows for Rodger's operator use cases.

Initial workflow candidates:

- reservation_call_assistant
- social_draft_and_approve
- keynote_pdf_pack
- music_generate_and_release

Contract:

- each workflow accepts a normalized task envelope
- each workflow emits structured status updates
- each workflow reports terminal state with audit summary

Out of scope for core:

- personal prompt style
- personal posting calendar
- vendor account-specific distribution rules
