-- Pack 6 (S4): coarsen stored group locations.
--
-- Rounds every Group.latitude / Group.longitude to 2 decimals (~1 km;
-- STORED_PRECISION_DECIMALS in lib/geo.ts), the precision the app now stores
-- on every save (createGroupAction). Half away from zero, the same as
-- coarsenCoordinate() in lib/geo.ts.
--
-- IRREVERSIBLE: the original GPS precision is discarded and cannot be
-- restored. Data only; no schema change. Rows without a location and rows that
-- are already rounded are not touched. "updatedAt" is maintained by Prisma,
-- not the database, so it is left unchanged.
UPDATE "Group"
   SET "latitude"  = round("latitude"::numeric, 2)::double precision,
       "longitude" = round("longitude"::numeric, 2)::double precision
 WHERE ("latitude"  IS NOT NULL AND "latitude"  <> round("latitude"::numeric, 2)::double precision)
    OR ("longitude" IS NOT NULL AND "longitude" <> round("longitude"::numeric, 2)::double precision);
