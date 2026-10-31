-- PHASE 2: starting skills master data, session lookup index
INSERT INTO skills (id, name, class, type, mp_cost, power, target, required_level, effect) VALUES
 ('warrior_power_strike','パワースラッシュ','warrior','physical',4,1.6,'single',1,'{}'),
 ('knight_cover','かばう','knight','buff',3,0,'ally',1,'{"cover":true,"turns":2}'),
 ('mage_fire','ファイア','mage','magic',5,1.5,'single',1,'{"element":"fire"}'),
 ('priest_heal','ヒール','priest','heal',5,1.2,'ally',1,'{}');
CREATE INDEX ix_sessions_expires ON sessions(expires_at);
