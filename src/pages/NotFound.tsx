import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { PageSeo } from "@/components/seo/PageSeo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <PageSeo
        title="Page not found — Researcher"
        description="The page you are looking for does not exist."
        path={location.pathname}
        noindex
      />
      <main className="flex min-h-screen items-center justify-center bg-muted">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold">404</h1>
          <p className="mb-4 text-xl text-muted-foreground">Oops! Page not found</p>
          <a href="/" className="text-primary underline hover:text-primary/90">
            Return to Home
          </a>
        </div>
      </main>
    </>
  );
};

export default NotFound;
