-- Associate ideas with a specific house zone, so decor/photo ideas can be
-- collected per zone on the Theme & Zones page. (Already present on the live
-- DB; this documents the column and covers any deployment that lacks it.)
ALTER TABLE ideas ADD COLUMN zone_id INTEGER;
