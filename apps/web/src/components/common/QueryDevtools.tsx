"use client";

import dynamic from "next/dynamic";

const ReactQueryDevtools =
  process.env.NODE_ENV === "development"
    ? dynamic(
        () =>
          import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools),
        { ssr: false }
      )
    : null;

const QueryDevtools = () => {
  if (!ReactQueryDevtools) return null;
  return <ReactQueryDevtools initialIsOpen={false} />;
};

export default QueryDevtools;
