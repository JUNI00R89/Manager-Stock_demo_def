-- La tabla users es de la primera versión y nunca se usó: las cuentas viven en auth_users.
-- Ninguna tabla la referencia y ningún código la lee ni la escribe.
DROP TABLE IF EXISTS users;
