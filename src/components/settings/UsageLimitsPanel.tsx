interface UsageLimitsPanelProps {
  maxRequestsPerHour: number;
  maxOutputTokens: number;
  dailyTokenBudget: number;
  onMaxRequestsPerHourChange: (value: number) => void;
  onMaxOutputTokensChange: (value: number) => void;
  onDailyTokenBudgetChange: (value: number) => void;
}

export function UsageLimitsPanel({
  maxRequestsPerHour,
  maxOutputTokens,
  dailyTokenBudget,
  onMaxRequestsPerHourChange,
  onMaxOutputTokensChange,
  onDailyTokenBudgetChange,
}: UsageLimitsPanelProps) {
  return (
    <fieldset className="limits-fieldset">
      <legend>安全用量上限</legend>
      <div className="limits-grid">
        <label className="field-label">
          每小时最多请求
          <input
            type="number"
            min="1"
            max="120"
            value={maxRequestsPerHour}
            onChange={(event) =>
              onMaxRequestsPerHourChange(Number(event.target.value))
            }
          />
        </label>
        <label className="field-label">
          单次最多输出 tokens
          <input
            type="number"
            min="256"
            max="16384"
            step="256"
            value={maxOutputTokens}
            onChange={(event) =>
              onMaxOutputTokensChange(Number(event.target.value))
            }
          />
        </label>
      </div>
      <label className="field-label">
        每日 token 预算
        <input
          type="number"
          min="10000"
          max="2000000"
          step="10000"
          value={dailyTokenBudget}
          onChange={(event) =>
            onDailyTokenBudgetChange(Number(event.target.value))
          }
        />
      </label>
    </fieldset>
  );
}
