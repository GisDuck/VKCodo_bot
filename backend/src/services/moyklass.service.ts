import { env } from "../config/env.js";
import { DEFAULT_MANAGER_ID } from "../domain/catalog.js";
import { approximateBirthdayFromAge, toIsoDate } from "../lib/dates.js";
import type { MoyKlassLesson } from "./lesson-format.service.js";
import { MoyKlassLogService } from "./moyklass-log.service.js";

type MoyKlassClass = {
  id: number;
  name?: string;
  courseId?: number;
};

type MoyKlassCourse = {
  id: number;
  name: string;
};

type MoyKlassUserInput = {
  childName: string;
  childAge?: number | null;
  phone: string;
  parentName?: string | null;
  filialId: number;
};

type CreateJoinInput = {
  userId: number;
  classId: number;
  managerId?: number;
  priceRubles?: number;
};

type CreateLessonRecordInput = {
  userId: number;
  lessonId: number;
};

type CreatePaymentInput = {
  userId: number;
  filialId: number;
  summaRubles: number;
  comment?: string;
  managerId?: number;
};

export class MoyKlassService {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private readonly log = new MoyKlassLogService();

  constructor(
    private readonly baseUrl = env.MOYKLASS_BASE_URL,
    private readonly apiKey = env.MOYKLASS_API_KEY
  ) {}

  async getCourses(): Promise<MoyKlassCourse[]> {
    return this.request<MoyKlassCourse[]>("/courses");
  }

  async createUser(input: MoyKlassUserInput): Promise<{ id: number }> {
    const birthday = input.childAge ? approximateBirthdayFromAge(input.childAge) : "";
    const phone = normalizePhoneForMoyKlass(input.phone);

    return this.request<{ id: number }>("/users", {
      method: "POST",
      body: {
        name: input.childName,
        phone,
        filials: [input.filialId],
        responsibles: [env.MOYKLASS_MANAGER_ID || DEFAULT_MANAGER_ID],
        attributes: [
          { attributeAlias: "birthday", value: birthday },
          { attributeAlias: "parent1", value: input.parentName ?? "" },
          { attributeAlias: "comment", value: "Клиент создан через бот" }
        ],
        utms: {
          utm_source: "bot",
          utm_medium: "bot",
          utm_campaign: "student_create",
          utm_content: "клиент_создан_через_бот"
        }
      }
    });
  }

  async getClasses(filialId: number, courseId: number): Promise<MoyKlassClass[]> {
    const query = new URLSearchParams({
      filialId: String(filialId),
      courseId: String(courseId)
    });

    return this.request<MoyKlassClass[]>(`/classes?${query.toString()}`);
  }

  async getLessons(input: {
    dateFrom: Date;
    dateTo: Date;
    classIds: number[];
  }): Promise<MoyKlassLesson[]> {
    const params = new URLSearchParams();
    params.append("date", toIsoDate(input.dateFrom));
    params.append("date", toIsoDate(input.dateTo));
    params.append("sort", "date");
    for (const classId of input.classIds) {
      params.append("classId", String(classId));
    }

    const response = await this.request<{ lessons?: MoyKlassLesson[] } | MoyKlassLesson[]>(
      `/lessons?${params.toString()}`
    );

    return Array.isArray(response) ? response : response.lessons ?? [];
  }

  async createJoin(input: CreateJoinInput): Promise<{ id: number }> {
    return this.request<{ id: number }>("/joins", {
      method: "POST",
      body: {
        userId: input.userId,
        classId: input.classId,
        comment: "Клиент создан через бот",
        autoJoin: false,
        price: input.priceRubles ?? 600,
        statusId: 12862,
        managerId: input.managerId ?? env.MOYKLASS_MANAGER_ID
      }
    });
  }

  async createLessonRecord(input: CreateLessonRecordInput): Promise<{ id: number }> {
    return this.request<{ id: number }>("/lessonRecords", {
      method: "POST",
      body: {
        userId: input.userId,
        lessonId: input.lessonId,
        free: false,
        visit: false,
        test: true
      }
    });
  }

  async createPayment(input: CreatePaymentInput): Promise<{ id: number }> {
    return this.request<{ id: number }>("/payments", {
      method: "POST",
      body: {
        userId: input.userId,
        date: toIsoDate(new Date()),
        summa: input.summaRubles,
        optype: "income",
        filialId: input.filialId,
        comment: input.comment ?? "Платеж выполнен через бот",
        managerId: input.managerId ?? env.MOYKLASS_MANAGER_ID,
        paymentTypeId: 1
      }
    });
  }

  async cancelLessonRecord(lessonRecordId: number): Promise<void> {
    await this.request(`/lessonRecords/${lessonRecordId}`, { method: "DELETE" });
  }

  async cancelJoin(joinId: number): Promise<void> {
    await this.request(`/joins/${joinId}`, {
      method: "PUT",
      body: { statusId: 0, comment: "Отменено через бот" }
    });
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (!this.apiKey) {
      throw new Error("MOYKLASS_API_KEY is not configured");
    }

    const token = await this.getAccessToken();
    const method = init?.method ?? "GET";
    const url = `${this.baseUrl}${path}`;
    const startedAt = Date.now();
    const response = await fetch(url, {
      method,
      headers: {
        "x-access-token": token,
        "Content-Type": "application/json"
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const responseText = await response.text();
    const responseBody = parseBody(responseText);

    await this.log.write({
      event: "moyklass_request",
      method,
      path,
      url,
      requestBody: init?.body ?? null,
      responseStatus: response.status,
      responseBody,
      durationMs: Date.now() - startedAt
    });

    if (!response.ok) {
      throw new Error(`MoyKlass ${method} ${path} failed: ${response.status} ${responseText}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return responseBody as T;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiresAt > Date.now() + 60_000) {
      return this.accessToken;
    }

    const method = "POST";
    const path = "/auth/getToken";
    const url = `${this.baseUrl}${path}`;
    const startedAt = Date.now();
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: this.apiKey })
    });
    const responseText = await response.text();
    const responseBody = parseBody(responseText);

    await this.log.write({
      event: "moyklass_request",
      method,
      path,
      url,
      requestBody: { apiKey: maskSecret(this.apiKey) },
      responseStatus: response.status,
      responseBody: maskAuthResponse(responseBody),
      durationMs: Date.now() - startedAt
    });

    if (!response.ok) {
      throw new Error(`MoyKlass auth failed: ${response.status} ${responseText}`);
    }

    const data = responseBody as { accessToken?: string; expiresIn?: number };
    if (!data.accessToken) {
      throw new Error("MoyKlass auth response does not contain accessToken");
    }

    this.accessToken = data.accessToken;
    this.accessTokenExpiresAt = Date.now() + (data.expiresIn ?? 3600) * 1000;
    return this.accessToken;
  }
}

function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function maskAuthResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return {
    ...value,
    accessToken: "****"
  };
}

function normalizePhoneForMoyKlass(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error("MoyKlass phone must contain 10-15 digits");
  }
  return digits;
}
