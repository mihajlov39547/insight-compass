import { Helmet } from "react-helmet-async";

const SITE_URL = "https://rsrcher.com";

interface PageSeoProps {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
}

export function PageSeo({ title, description, path, noindex }: PageSeoProps) {
  const url = `${SITE_URL}${path}`;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {noindex && <meta name="robots" content="noindex" />}
    </Helmet>
  );
}
