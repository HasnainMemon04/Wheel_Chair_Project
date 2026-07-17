-- Real NEO-M8N and MPU6500 values exposed in the hot device snapshot.
-- These are physical sensor readings only; no simulated GPS values are stored.
alter table public.device_state add column if not exists gps_fix boolean default false;
alter table public.device_state add column if not exists gps_course real;
alter table public.device_state add column if not exists gps_altitude real;
alter table public.device_state add column if not exists gps_age_ms int;
alter table public.device_state add column if not exists gps_chars bigint;
alter table public.device_state add column if not exists gps_sentences bigint;
alter table public.device_state add column if not exists gps_checksum_failures bigint;
alter table public.device_state add column if not exists gps_nmea_gga text;
alter table public.device_state add column if not exists gps_nmea_rmc text;

alter table public.device_state add column if not exists imu_accel_x real;
alter table public.device_state add column if not exists imu_accel_y real;
alter table public.device_state add column if not exists imu_accel_z real;
alter table public.device_state add column if not exists imu_gyro_x real;
alter table public.device_state add column if not exists imu_gyro_y real;
alter table public.device_state add column if not exists imu_gyro_z real;
alter table public.device_state add column if not exists imu_age_ms int;
