export default function ApiHome() {
  return (
    <main>
      <section>
        <p>RELAY / API</p>
        <h1>Signal enters here.</h1>
        <p>
          This service authenticates ingestion and connector callbacks. Durable processing belongs
          to Cloudflare Queues, Durable Objects, and Workflows.
        </p>
        <code>GET /api/health</code>
      </section>
    </main>
  );
}
