import type {ReactNode} from 'react';
import {useEffect} from 'react';
import Layout from '@theme/Layout';

const DECAP_CMS_SCRIPT = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';

export default function Admin(): ReactNode {
  useEffect(() => {
    if (document.querySelector(`script[src="${DECAP_CMS_SCRIPT}"]`)) {
      return;
    }

    const script = document.createElement('script');
    script.src = DECAP_CMS_SCRIPT;
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return (
    <Layout title="Admin" noFooter>
      <main id="nc-root" />
    </Layout>
  );
}
