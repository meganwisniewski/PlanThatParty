-- #41/#42: richer public guest homepage + guest RSVP / reach-out.
ALTER TABLE party ADD COLUMN costume_guidance TEXT;
ALTER TABLE party ADD COLUMN transit_info TEXT;
ALTER TABLE party ADD COLUMN show_times TEXT;
ALTER TABLE party ADD COLUMN photo_album_url TEXT;
ALTER TABLE guests ADD COLUMN guest_message TEXT;
