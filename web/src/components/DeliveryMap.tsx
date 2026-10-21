import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MaplibreMap, Marker } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DeliveryOption } from '../types';

maplibregl.setWorkerUrl(workerUrl);

type Coordinates = { lat: number; lon: number };

export function DeliveryMap({ points, selectedId, onSelect, onPickLocation, location }: {
  points: DeliveryOption[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onPickLocation?: (position: Coordinates) => void;
  location?: Coordinates;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MaplibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const callbacks = useRef({ onPickLocation, onSelect });
  const [failed, setFailed] = useState(false);
  callbacks.current = { onPickLocation, onSelect };

  useEffect(() => {
    if (!container.current) return;
    const instance = new maplibregl.Map({
      container: container.current,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [37.6173, 55.7558], zoom: 10,
      cooperativeGestures: true,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.on('click', (event) => callbacks.current.onPickLocation?.({ lat: Number(event.lngLat.lat.toFixed(6)), lon: Number(event.lngLat.lng.toFixed(6)) }));
    instance.on('error', () => { if (!instance.isStyleLoaded()) setFailed(true); });
    instance.on('load', () => setFailed(false));
    return () => { markers.current.forEach((marker) => marker.remove()); markers.current = []; map.current = null; instance.remove(); };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    markers.current.forEach((marker) => marker.remove());
    const locations = points.filter((point): point is DeliveryOption & Coordinates => point.lat !== undefined && point.lon !== undefined);
    markers.current = locations.map((point) => {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'delivery-map-pin';
      pin.dataset.pointId = point.id;
      pin.setAttribute('aria-label', `${point.point}, ${point.address}`);
      pin.title = point.point;
      pin.textContent = '•';
      pin.addEventListener('click', (event) => { event.stopPropagation(); callbacks.current.onSelect?.(point.id); });
      return new maplibregl.Marker({ element: pin }).setLngLat([point.lon, point.lat]).addTo(instance);
    });
    if (location) {
      const pin = document.createElement('div');
      pin.className = 'delivery-map-pin active';
      pin.setAttribute('aria-label', 'Выбранное место');
      markers.current.push(new maplibregl.Marker({ element: pin }).setLngLat([location.lon, location.lat]).addTo(instance));
    }
    const all = [...locations.map((point) => [point.lon, point.lat] as [number, number]), ...(location ? [[location.lon, location.lat] as [number, number]] : [])];
    if (all.length === 1) instance.jumpTo({ center: all[0], zoom: 14 });
    else if (all.length > 1) {
      const bounds = all.reduce((b, coordinate) => b.extend(coordinate), new maplibregl.LngLatBounds(all[0], all[0]));
      instance.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
    }
    return () => { markers.current.forEach((marker) => marker.remove()); markers.current = []; };
  }, [points, location?.lat, location?.lon]);

  useEffect(() => {
    markers.current.forEach((marker) => {
      const pin = marker.getElement();
      const active = pin.dataset.pointId === selectedId;
      pin.classList.toggle('active', active);
      if (pin.dataset.pointId) pin.setAttribute('aria-pressed', String(active));
    });
    const point = points.find((item) => item.id === selectedId);
    if (point?.lat != null && point.lon != null) {
      map.current?.easeTo({ center: [point.lon, point.lat], zoom: Math.max(map.current.getZoom(), 13), duration: 250 });
    }
  }, [points, selectedId]);

  return <div className="delivery-map-shell"><div ref={container} className="delivery-map" role="region" aria-label="Карта пунктов выдачи" />{failed && <p className="delivery-map-error">Карта не загрузилась. Выберите пункт в списке ниже.</p>}</div>;
}
