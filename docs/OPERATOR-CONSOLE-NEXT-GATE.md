# Next Gate After Package 13

1. Configure `salesbot-dev` Supabase/PostgreSQL.
2. Apply migrations 001, 002, 003.
3. Boot Bridge.
4. Run `node scripts/apply-package-13.mjs`.
5. Run Bridge + web tests.
6. Provision HVAC test price book into self-hosted Bidwright.
7. Use SalesBot Quote Builder to run the Ahmad / Ipoh / 3 x 2HP M1 scenario.
8. Confirm exactly one quote reaches `PENDING_APPROVAL`.

After M1 passes, build the human approval/revision/PDF/delivery sprint.
