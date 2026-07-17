-- Required for real live OTA status/progress in the web UI.
alter table public.wheelchairs add column if not exists target_version text;
alter table public.wheelchairs add column if not exists ota_status text default 'idle';
alter table public.wheelchairs add column if not exists ota_progress int default 0;
alter table public.wheelchairs add column if not exists ota_last_error text;

alter table public.device_state add column if not exists fw_version text;
alter table public.device_state add column if not exists target_version text;
alter table public.device_state add column if not exists ota_status text default 'idle';
alter table public.device_state add column if not exists ota_progress int default 0;
alter table public.device_state add column if not exists ota_last_error text;
alter table public.device_state add column if not exists yaw real default 0.0;

-- Older deployed schemas used occupied; current firmware sends in_motion.
alter table public.device_state add column if not exists in_motion boolean default false;
