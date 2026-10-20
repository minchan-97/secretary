import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '업무 비서',
    short_name: '비서',
    start_url: '/',
    display: 'standalone',
    background_color: '#E8ECF0',
    theme_color: '#1D2740',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
