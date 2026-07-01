'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DeviceState } from '../hooks/useFleetState';

interface MapProps {
  deviceStates: DeviceState[];
  selectedId: string | null;
  onSelectDevice?: (id: string) => void;
}

interface MarkerAnimationData {
  marker: L.Marker;
  circle: L.Circle | null;
  currentLat: number;
  currentLng: number;
  startLat: number;
  startLng: number;
  targetLat: number;
  targetLng: number;
  bearing: number;
  startTime: number;
  duration: number;
  animationFrameId?: number;
}

// Calculate bearing angle between two LatLng coordinates
function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

export default function Map({ deviceStates, selectedId, onSelectDevice }: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, MarkerAnimationData>>({});

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center coordinates (default: Karachi from specs)
    const defaultCenter: L.LatLngExpression = [24.860731, 67.001142];
    
    // Create map instance
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 15,
      zoomControl: false,
      attributionControl: false
    });

    // Dark-first tile layer (styled via CSS .dark-map filter in globals.css)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({
      position: 'bottomright'
    }).addTo(map);

    mapRef.current = map;

    return () => {
      // Clean up map on unmount
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update Markers & Geofences
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentDevices = new Set<string>();

    deviceStates.forEach((device) => {
      const { wheelchair_id, lat, lng, online, locked, geofence } = device;
      
      // If coordinates are invalid, skip
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

      currentDevices.add(wheelchair_id);

      // Determine state colors
      const isBreached = geofence ? geofence.in === 0 : false;
      const isTampered = !!device.tamper;
      const themeColor = !online
        ? '#9ca3af' // gray
        : isTampered
        ? '#ef4444' // red if tamper alarm
        : isBreached
        ? '#ef4444' // red if geofence breached
        : locked
        ? '#3b82f6' // blue if locked
        : '#10b981'; // green if active/unlocked

      const existing = markersRef.current[wheelchair_id];
      const currentBearing = existing ? existing.bearing : 0;

      // Create Custom SVG Marker Icon with directional indicator pointing forward
      const customIcon = L.divIcon({
        className: 'custom-wheelchair-marker',
        html: `
          <div class="pulse-marker" style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px;">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(${currentBearing}deg); transition: transform 0.3s ease-out; transform-origin: center;">
              <circle cx="18" cy="18" r="14" fill="${themeColor}" fill-opacity="0.15" stroke="${themeColor}" stroke-width="2.5"/>
              <circle cx="18" cy="18" r="6" fill="${themeColor}" stroke="#ffffff" stroke-width="1.5"/>
              <path d="M18 4L22 9H14L18 4Z" fill="#ffffff" />
            </svg>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        popupAnchor: [0, -18]
      });

      if (!existing) {
        // Create new Marker
        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

        // Bind interactive popup
        const popupContent = `
          <div class="p-1">
            <h3 class="font-bold text-sm text-foreground">${wheelchair_id}</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Status: <span class="font-medium" style="color: ${themeColor}">${
              !online ? 'Offline' : isTampered ? 'Tamper Alarm' : isBreached ? 'Breached' : locked ? 'Locked' : 'Active'
            }</span></p>
            <p class="text-xs text-muted-foreground">Battery: ${device.batt_pct}% (${device.batt_v.toFixed(2)}V)</p>
            ${
              device.temp_amb !== undefined && device.temp_amb !== null
                ? `<p class="text-xs text-muted-foreground mt-0.5">Climate: ${device.temp_amb.toFixed(1)}°C / ${device.humidity.toFixed(1)}%</p>`
                : ''
            }
          </div>
        `;
        marker.bindPopup(popupContent);

        if (onSelectDevice) {
          marker.on('click', () => {
            onSelectDevice(wheelchair_id);
          });
        }

        // Draw Geofence Circle overlay if config present
        let geofenceCircle: L.Circle | null = null;
        const gfRadius = geofence?.r || 300;

        if (geofence && geofence.on === 1) {
          const gfCenterLat = (geofence as any)?.lat !== undefined ? (geofence as any).lat : lat;
          const gfCenterLng = (geofence as any)?.lng !== undefined ? (geofence as any).lng : lng;
          geofenceCircle = L.circle([gfCenterLat, gfCenterLng], {
            radius: gfRadius,
            color: isBreached ? '#ef4444' : '#3b82f6',
            fillColor: isBreached ? '#ef4444' : '#3b82f6',
            fillOpacity: isBreached ? 0.12 : 0.04,
            weight: 1.5,
            dashArray: '4, 4'
          }).addTo(map);
        }

        markersRef.current[wheelchair_id] = {
          marker,
          circle: geofenceCircle,
          currentLat: lat,
          currentLng: lng,
          startLat: lat,
          startLng: lng,
          targetLat: lat,
          targetLng: lng,
          bearing: 0,
          startTime: 0,
          duration: 800
        };
      } else {
        // Update Marker icon to reflect potential color changes
        existing.marker.setIcon(customIcon);

        // Update popup content
        const popupContent = `
          <div class="p-1">
            <h3 class="font-bold text-sm text-foreground">${wheelchair_id}</h3>
            <p class="text-xs text-muted-foreground mt-0.5">Status: <span class="font-medium" style="color: ${themeColor}">${
              !online ? 'Offline' : isTampered ? 'Tamper Alarm' : isBreached ? 'Breached' : locked ? 'Locked' : 'Active'
            }</span></p>
            <p class="text-xs text-muted-foreground">Battery: ${device.batt_pct}% (${device.batt_v.toFixed(2)}V)</p>
            ${
              device.temp_amb !== undefined && device.temp_amb !== null
                ? `<p class="text-xs text-muted-foreground mt-0.5">Climate: ${device.temp_amb.toFixed(1)}°C / ${device.humidity.toFixed(1)}%</p>`
                : ''
            }
          </div>
        `;
        existing.marker.setPopupContent(popupContent);

        // Update geofence overlay properties
        const gfRadius = geofence?.r || 300;
        if (existing.circle) {
          existing.circle.setStyle({
            color: isBreached ? '#ef4444' : '#3b82f6',
            fillColor: isBreached ? '#ef4444' : '#3b82f6',
            fillOpacity: isBreached ? 0.12 : 0.04,
          });
          const gfCenterLat = (geofence as any)?.lat !== undefined ? (geofence as any).lat : lat;
          const gfCenterLng = (geofence as any)?.lng !== undefined ? (geofence as any).lng : lng;
          existing.circle.setLatLng([gfCenterLat, gfCenterLng]);
          existing.circle.setRadius(gfRadius);
        } else if (geofence && geofence.on === 1) {
          const gfCenterLat = (geofence as any)?.lat !== undefined ? (geofence as any).lat : lat;
          const gfCenterLng = (geofence as any)?.lng !== undefined ? (geofence as any).lng : lng;
          existing.circle = L.circle([gfCenterLat, gfCenterLng], {
            radius: gfRadius,
            color: isBreached ? '#ef4444' : '#3b82f6',
            fillColor: isBreached ? '#ef4444' : '#3b82f6',
            fillOpacity: isBreached ? 0.12 : 0.04,
            weight: 1.5,
            dashArray: '4, 4'
          }).addTo(map);
        }

        // Animate marker transition (60fps interpolation loop)
        if (existing.targetLat !== lat || existing.targetLng !== lng) {
          if (existing.animationFrameId) {
            cancelAnimationFrame(existing.animationFrameId);
          }

          existing.startLat = existing.currentLat;
          existing.startLng = existing.currentLng;
          existing.targetLat = lat;
          existing.targetLng = lng;
          
          // Calculate heading bearing dynamically from GPS movement
          const latDiff = Math.abs(lat - existing.currentLat);
          const lngDiff = Math.abs(lng - existing.currentLng);
          if (latDiff > 0.00001 || lngDiff > 0.00001) {
            existing.bearing = calculateBearing(existing.currentLat, existing.currentLng, lat, lng);
          }
          
          existing.startTime = performance.now();

          const animate = (time: number) => {
            const elapsed = time - existing.startTime;
            const progress = Math.min(elapsed / existing.duration, 1.0);
            
            // easeOutQuad easing
            const ease = progress * (2 - progress);
            
            const curLat = existing.startLat + (existing.targetLat - existing.startLat) * ease;
            const curLng = existing.startLng + (existing.targetLng - existing.startLng) * ease;
            
            existing.currentLat = curLat;
            existing.currentLng = curLng;
            existing.marker.setLatLng([curLat, curLng]);
            
            // Apply bearing rotation directly to SVG inside Leaflet marker DOM element
            const markerElement = existing.marker.getElement();
            if (markerElement) {
              const svgElement = markerElement.querySelector('svg') as SVGSVGElement;
              if (svgElement) {
                svgElement.style.transform = `rotate(${existing.bearing}deg)`;
              }
            }
            
            if (progress < 1.0) {
              existing.animationFrameId = requestAnimationFrame(animate);
            }
          };

          existing.animationFrameId = requestAnimationFrame(animate);
        }
      }
    });

    // Cleanup removed devices
    Object.keys(markersRef.current).forEach((id) => {
      if (!currentDevices.has(id)) {
        const entry = markersRef.current[id];
        if (entry.animationFrameId) cancelAnimationFrame(entry.animationFrameId);
        entry.marker.remove();
        if (entry.circle) entry.circle.remove();
        delete markersRef.current[id];
      }
    });

  }, [deviceStates, onSelectDevice]);

  // Center on selected wheelchair dynamically as its coordinates update
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;

    const device = deviceStates.find(d => d.wheelchair_id === selectedId);
    if (device && !isNaN(device.lat) && !isNaN(device.lng)) {
      map.setView([device.lat, device.lng], map.getZoom() || 16, {
        animate: true,
        duration: 0.5
      });
    }
  }, [selectedId, deviceStates]);

  return (
    <div className="relative h-full w-full dark-map">
      <div ref={mapContainerRef} className="h-full w-full outline-none" />
    </div>
  );
}
