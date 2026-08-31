# @frontdesk-q/pricing

Bridge-side pricing metadata and provider resolution.

The package stores:

- active price-book metadata
- opaque offering bindings
- Bidwright IDs
- snapshot mappings

It does **not** own authoritative selling rates. Product prices are read from the
tenant Bidwright catalog; service prices are read from the active Bidwright global
rate schedule. Quote service rates are then snapshotted into the exact Bidwright
revision before worksheet mutation.
