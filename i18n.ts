import {getRequestConfig} from 'next-intl/server';
import {notFound} from 'next/navigation';

const locales = ['en', 'de', 'es', 'fr', 'it'];


export default getRequestConfig(async ({ requestLocale }) => {
  
  let currentLocale = await requestLocale;

  if (!currentLocale || !locales.includes(currentLocale as string)) {
    currentLocale = 'en';
  }

  return {
    locale: currentLocale,
    messages: (await import(`./messages/${currentLocale}.json`)).default
  };
});