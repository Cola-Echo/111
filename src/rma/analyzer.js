/**
 * RMA 后处理分析引擎
 * 构建 prompt → 调用 AI → 解析结构化结果
 * @module rma/analyzer
 */

import Logger from '@core/logger';
import { getCurrentCharacterDescription } from '@core/sillytavern-api';
import APIAdapter from '@api/adapter';
import { getRmaAnalysisApiConfig } from './index';
import { getCurrentRmaConfig, getSensitivities, getEmotionalProcessing, getSecrets, getPhaseDefinitions } from './config-loader';
import { getRmaState, getRelevantMemories, getUnresolvedThreads, getCurrentTexture, getPhase } from './memory-store';

const log = Logger.createModuleLogger('RMA-Analyzer');

const SYSTEM_PROMPT = `你是一个角色扮演分析引擎。你的任务是分析对话中发生的事件，评估它们对角色关系和情感状态的影响。

你需要输出两部分内容：
1. 一个 JSON 代码块（用 \`\`\`json 包裹），包含结构化的记忆/状态更新
2. 一个 [NARRATIVE] 标记后的自然语言段落，描述角色当前内心状态（200-400 token）

规则：
- 只在真正发生了对角色有意义的事时才创建记忆。日常寒暄不需要记忆。
- 阶段变化需要积累足够的记忆支持，不要轻易改变。
- 参考角色的敏感点来判断事件重要性。
- 参考情绪处理模式来区分表面反应和真实感受。
- crack 类型记忆必须说明 lasting_effect。
- NARRATIVE 不要使用"阶段""变量""系统"等元语言，用角色本人的语气写。`;

/**
 * 构建用户 prompt
 */
function buildUserPrompt(recentMessages, latestResponse) {
    const config = getCurrentRmaConfig();
    if (!config) return '';

    const charDesc = getCurrentCharacterDescription();
    const sensitivities = getSensitivities(config);
    const emotional = getEmotionalProcessing(config);
    const secrets = getSecrets(config);
    const state = getRmaState();
    const currentPhase = getPhase();
    const relevantMems = getRelevantMemories(latestResponse);
    const threads = getUnresolvedThreads();
    const texture = getCurrentTexture();

    const parts = [];

    parts.push(`## 角色设定\n${charDesc || '无'}`);

    // 敏感点
    if (Object.keys(sensitivities).length > 0) {
        const lines = Object.entries(sensitivities).map(([id, s]) =>
            `- ${id}: ${s.description}（反应: ${s.reaction}，原因: ${s.why}）`
        );
        parts.push(`## 敏感点\n${lines.join('\n')}`);
    }

    // 情感处理模式
    if (emotional.style) {
        parts.push(`## 情感处理模式\n风格: ${emotional.style}\n${emotional.description || ''}\n表达模式: ${emotional.expression_pattern || ''}\n防御机制: ${emotional.defense_mechanism || ''}`);
    }

    // 秘密路径
    if (Object.keys(secrets).length > 0) {
        const lines = Object.entries(secrets).map(([id, s]) => {
            const currentStage = state?.secrets?.[id]?.current_stage || s.initial_stage;
            const stages = s.stages?.map(st => st.id === currentStage ? `[${st.name}]` : st.name).join(' → ') || '';
            return `- ${id}: ${s.description}（当前: ${currentStage}，路径: ${stages}）`;
        });
        parts.push(`## 秘密路径\n${lines.join('\n')}`);
    }

    // 当前阶段
    const phaseDefs = getPhaseDefinitions(config);
    const phaseNames = phaseDefs.map(p => p.name === currentPhase ? `[${p.name}]` : p.name).join(' → ');
    parts.push(`## 当前关系阶段\n${currentPhase || '未知'}（路径: ${phaseNames}）\n趋势: ${state?.phase?.tendency || 'stable'}`);

    // 现有记忆
    if (relevantMems.length > 0) {
        const memLines = relevantMems.map(m =>
            `- [${m.type}] 第${m.day}天: ${m.event}（影响: ${m.emotional_impact}${m.lasting_effect ? `，持续: ${m.lasting_effect}` : ''}）`
        );
        parts.push(`## 现有记忆\n${memLines.join('\n')}`);
    } else {
        parts.push('## 现有记忆\n无');
    }

    // 当前质感
    parts.push(`## 当前情感纹理\n${texture || '无'}`);

    // 未解决事项
    if (threads.length > 0) {
        parts.push(`## 未解决的事\n${threads.map(t => `- ${t}`).join('\n')}`);
    }

    // 最近对话
    if (recentMessages && recentMessages.length > 0) {
        const msgLines = recentMessages.map(m =>
            `${m.is_user ? '用户' : '角色'}: ${m.mes?.slice(0, 500) || ''}`
        );
        parts.push(`## 最近对话\n${msgLines.join('\n')}`);
    }

    // 最新回复
    parts.push(`## AI 最新回复\n${latestResponse || '无'}`);

    return parts.join('\n\n');
}

/**
 * 解析 AI 输出，分离 JSON 和 NARRATIVE
 * @param {string} text AI 原始输出
 * @returns {{ json: object|null, narrative: string }}
 */
function parseAnalysisOutput(text) {
    let json = null;
    let narrative = '';

    // 提取 JSON 代码块
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            json = JSON.parse(jsonMatch[1].trim());
        } catch (e) {
            log.warn('JSON 解析失败:', e.message);
        }
    }

    // 如果没有代码块格式，尝试直接找 JSON 对象
    if (!json) {
        const braceMatch = text.match(/\{[\s\S]*"new_memories"[\s\S]*\}/);
        if (braceMatch) {
            try {
                json = JSON.parse(braceMatch[0]);
            } catch {
                // ignore
            }
        }
    }

    // 提取 NARRATIVE
    const narrativeMatch = text.match(/\[NARRATIVE\]\s*([\s\S]*?)(?:$|```)/i);
    if (narrativeMatch) {
        narrative = narrativeMatch[1].trim();
    } else {
        // 尝试取 JSON 代码块之后的所有内容
        const afterJson = text.replace(/```json[\s\S]*?```/, '').trim();
        if (afterJson.length > 50) {
            narrative = afterJson;
        }
    }

    return { json, narrative };
}

/**
 * 验证分析结果
 * @param {object} json 解析后的 JSON
 * @param {object} config RMA 配置
 * @returns {object} 清理后的结果
 */
function validateAnalysisResult(json, config) {
    if (!json) return null;

    const validTypes = ['breakthrough', 'warmth', 'crack', 'revelation'];
    const phaseNames = getPhaseDefinitions(config).map(p => p.name || p.id);
    const secretIds = Object.keys(getSecrets(config));

    // 过滤非法记忆类型
    if (json.new_memories) {
        json.new_memories = json.new_memories.filter(m => {
            if (!validTypes.includes(m.type)) {
                log.warn(`过滤非法记忆类型: ${m.type}`);
                return false;
            }
            return true;
        });
    }

    // 验证阶段名
    if (json.phase_assessment?.new_phase) {
        if (!phaseNames.includes(json.phase_assessment.new_phase)) {
            log.warn(`非法阶段名: ${json.phase_assessment.new_phase}，已忽略`);
            json.phase_assessment.phase_changed = false;
            json.phase_assessment.new_phase = null;
        }
    }

    // 验证秘密 ID
    if (json.secret_updates) {
        for (const id of Object.keys(json.secret_updates)) {
            if (!secretIds.includes(id)) {
                log.warn(`非法秘密 ID: ${id}，已移除`);
                delete json.secret_updates[id];
            }
        }
    }

    return json;
}

/**
 * 执行后处理分析
 * @param {Array} recentMessages 最近的聊天消息
 * @param {string} latestResponse 最新 AI 回复
 * @returns {Promise<{json: object, narrative: string}|null>} 分析结果
 */
export async function analyzeResponse(recentMessages, latestResponse) {
    const config = getCurrentRmaConfig();
    if (!config) return null;

    const apiConfig = getRmaAnalysisApiConfig();
    if (!apiConfig?.apiUrl || !apiConfig?.model) {
        log.warn('RMA 分析 API 未配置');
        return null;
    }

    const userPrompt = buildUserPrompt(recentMessages, latestResponse);

    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
        try {
            log.log(`发送后处理分析请求 (尝试 ${retries + 1}/${maxRetries + 1})`);

            const result = await APIAdapter.call(
                apiConfig,
                SYSTEM_PROMPT,
                userPrompt,
            );

            if (!result) {
                log.warn('API 返回空结果');
                retries++;
                continue;
            }

            const { json, narrative } = parseAnalysisOutput(result);

            if (!json && retries < maxRetries) {
                log.warn('JSON 解析失败，重试...');
                retries++;
                continue;
            }

            const validated = validateAnalysisResult(json, config);

            return {
                json: validated,
                narrative: narrative || '',
                raw: result,
            };
        } catch (e) {
            log.warn(`分析请求失败 (尝试 ${retries + 1}):`, e.message);
            retries++;
        }
    }

    log.warn('后处理分析失败，已达到最大重试次数');
    return null;
}
