export function POST() {
  // Fail closed until Pub/Sub JWT verification and connector ownership resolution are implemented.
  return Response.json(
    {
      error: {
        code: "gmail_connector_not_configured",
        message: "Gmail push ingestion is not enabled",
      },
    },
    { status: 501 },
  );
}
