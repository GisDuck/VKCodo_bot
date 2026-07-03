import type { FastifyInstance } from "fastify";
import { BookingService } from "../services/booking.service.js";

export async function paymentsRoutes(app: FastifyInstance) {
  const booking = new BookingService();

  app.get("/payment/success", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(paymentPage({
      title: "Оплата прошла",
      eyebrow: "Codorobot",
      heading: "Оплата получена",
      text:
        "Спасибо! Мы уже получили уведомление от банка. Вернитесь в VK, там будет актуальный статус записи.",
      tone: "success"
    }));
  });

  app.get("/payment/fail", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(paymentPage({
      title: "Оплата не прошла",
      eyebrow: "Codorobot",
      heading: "Оплата не завершена",
      text:
        "Можно попробовать оплатить еще раз из VK или выбрать оплату в филиале перед занятием.",
      tone: "fail"
    }));
  });

  app.post("/api/payments/:orderId/init", async (request) => {
    const { orderId } = request.params as { orderId: string };
    return booking.initOnlinePayment(orderId);
  });
}

function paymentPage(input: {
  title: string;
  eyebrow: string;
  heading: string;
  text: string;
  tone: "success" | "fail";
}) {
  const accent = input.tone === "success" ? "#188f5d" : "#b45b22";
  const soft = input.tone === "success" ? "#eaf7f1" : "#fff3e8";
  const icon = input.tone === "success" ? "✓" : "!";

  return `
    <!doctype html>
    <html lang="ru">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${input.title}</title>
        <style>
          :root {
            color-scheme: light;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f6f8fb;
            color: #17212f;
          }

          * {
            box-sizing: border-box;
          }

          body {
            min-height: 100vh;
            margin: 0;
            display: grid;
            place-items: center;
            padding: 24px;
            background:
              radial-gradient(circle at 20% 0%, rgba(24, 143, 93, 0.09), transparent 32rem),
              linear-gradient(180deg, #ffffff 0%, #f3f6fa 100%);
          }

          main {
            width: min(100%, 520px);
            padding: 34px;
            border: 1px solid #dde4ee;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.92);
            box-shadow: 0 24px 70px rgba(28, 42, 63, 0.14);
          }

          .mark {
            width: 54px;
            height: 54px;
            display: grid;
            place-items: center;
            border-radius: 50%;
            margin-bottom: 24px;
            background: ${soft};
            color: ${accent};
            font-size: 30px;
            font-weight: 800;
          }

          .eyebrow {
            margin: 0 0 8px;
            color: ${accent};
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0;
            text-transform: uppercase;
          }

          h1 {
            margin: 0;
            font-size: clamp(30px, 8vw, 46px);
            line-height: 1.04;
            letter-spacing: 0;
          }

          p {
            margin: 18px 0 0;
            color: #4d5d70;
            font-size: 18px;
            line-height: 1.55;
          }

          .hint {
            margin-top: 26px;
            padding-top: 18px;
            border-top: 1px solid #e5ebf2;
            font-size: 15px;
            color: #718095;
          }

          @media (max-width: 520px) {
            body {
              padding: 16px;
            }

            main {
              padding: 26px;
              border-radius: 14px;
            }

            p {
              font-size: 16px;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <div class="mark">${icon}</div>
          <p class="eyebrow">${input.eyebrow}</p>
          <h1>${input.heading}</h1>
          <p>${input.text}</p>
          <p class="hint">Эту вкладку можно закрыть после возвращения в диалог.</p>
        </main>
      </body>
    </html>
  `;
}
