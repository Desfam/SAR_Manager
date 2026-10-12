# Zertifikate

`pve-root-ca.pem` – die CA des Proxmox-Clusters (auf jedem Node unter `/etc/pve/pve-root-ca.pem`).
Liegt die Datei hier, startet die App das Backend mit `NODE_EXTRA_CA_CERTS`, sodass die
Proxmox-API mit eingeschalteter Zertifikatsprüfung erreichbar ist.

Backend von Hand starten:

    NODE_EXTRA_CA_CERTS=../certs/pve-root-ca.pem npm run dev
