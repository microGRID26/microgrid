-- #535 — Document the EPC-internal labor invariant at schema level.
--
-- Today all 28 project_cost_line_item_templates split into two populations:
--   • equipment rows:  is_epc_internal=false, default_markup_distro_to_epc = 0.005 (chain spread)
--   • EPC labor rows:  is_epc_internal=true,  default_markup_distro_to_epc = 0
--
-- Equipment moves through the distribution chain (DSE → NewCo → EPC) and
-- carries the 0.5% NewCo→EPC spread on its way. Labor never touches that
-- chain — it's EPC's own work, not equipment moving between entities. The
-- 0% markup on labor is what keeps the chain math correct.
--
-- The split is undocumented at schema level: a future template added with
-- is_epc_internal=true AND default_markup_to_distro_to_epc=0.005 (defaulted
-- via column default or copied from an equipment row) silently routes EPC
-- labor through the spread, inflating EPC→EDGE invoices.
--
-- Lock this in as a CHECK so the bad combination is impossible.

ALTER TABLE public.project_cost_line_item_templates
  ADD CONSTRAINT cost_template_epc_internal_no_markup
  CHECK (is_epc_internal = false OR default_markup_distro_to_epc = 0)
  NOT VALID;

ALTER TABLE public.project_cost_line_item_templates
  VALIDATE CONSTRAINT cost_template_epc_internal_no_markup;

COMMENT ON CONSTRAINT cost_template_epc_internal_no_markup
  ON public.project_cost_line_item_templates IS
  'EPC-internal labor templates must carry default_markup_distro_to_epc = 0; only
   equipment templates pass through the NewCo→EPC chain spread (#535).';
