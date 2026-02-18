
import { ThingSpeakResponse, TimeRange } from '../types';
import { THINGSPEAK_CHANNEL_ID, THINGSPEAK_READ_KEY } from '../constants';

export const fetchLatestFeed = async (): Promise<ThingSpeakResponse> => {
  const url = `https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds.json?api_key=${THINGSPEAK_READ_KEY}&results=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch current reading');
  return res.json();
};

export const fetchHistory = async (range: TimeRange): Promise<ThingSpeakResponse> => {
  let results = 100;
  let days = 1;

  switch (range) {
    case '24h':
      results = 144; // Approx 1 reading per 10 mins
      days = 1;
      break;
    case '7d':
      results = 500;
      days = 7;
      break;
    case '30d':
      results = 1000;
      days = 30;
      break;
  }

  const url = `https://api.thingspeak.com/channels/${THINGSPEAK_CHANNEL_ID}/feeds.json?api_key=${THINGSPEAK_READ_KEY}&results=${results}&days=${days}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch historical data');
  return res.json();
};

export const exportToCSV = (feeds: any[]) => {
  const headers = ['Timestamp', 'Temperature (C)', 'Humidity (%)'];
  const rows = feeds.map(f => [f.created_at, f.field1, f.field2]);
  const content = [headers, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `env_data_${new Date().toISOString()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
