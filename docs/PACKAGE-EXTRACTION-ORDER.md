# Extraction Order — M1 Patch Packages

All ZIP files in this release contain the root folder:

```text
frontdesk-q/
```

Extract them from the directory **containing** your existing `frontdesk-q/` repository.

Recommended order:

```text
08 HVAC price-book merge
09 Offering search + price resolution
10 Deterministic quote saga
11 M1 automated tests
12 AGPL legal-review fact pack
```

Files intentionally overlap where a later module requires an update to an earlier shared file.
Allow extraction to overwrite those paths.

Alternative:

- extract `frontdesk-q-m1-complete-patch.zip` once over the previous foundation repository, or
- use `frontdesk-q-full-through-m1.zip` as a fresh complete repository snapshot.
