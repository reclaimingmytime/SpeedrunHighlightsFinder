import { NotFoundException } from '@nestjs/common';

import type { ApiResponse, ApiResponseData, ErrorPayload } from '../types';

export async function makeApiRequest(endpoint: string): Promise<ApiResponseData> {
  const response = await fetch('https://api.mcsrranked.com/' + endpoint);
  const responseText = await response.text();

  if (!response.ok && !responseText.startsWith('{')) {
    throw new Error(
      `Network response was not ok for endpoint ${endpoint}. Status: ${response.status} ${response.statusText}. Text: ${responseText}`,
    );
  }
  const responseJson = JSON.parse(responseText) as ApiResponse;

  handleResponseError(responseJson, endpoint);
  return responseJson.data;
}

export function handleResponseError(responseJson: ApiResponse, endpoint: string) {
  if (responseJson.status === 'success') return;

  let message = `API request failed to endpoint ${endpoint}.`;
  const data = responseJson.data;

  if (typeof data === 'object' && data !== null) {
    const payload = data as ErrorPayload;
    const { error, query, params } = payload;

    if (error) {
      if (error === 'This player is not exist.') {
        throw new NotFoundException('This user does not exist.');
      }
      message += ` ${error}`;
    }

    if (query) message += ` Query validation failed: ${JSON.stringify(query)}`;
    if (params) message += ` Parameter validation failed: ${JSON.stringify(params)}`;
  } else if (typeof data === 'string') {
    message += ` ${data}`;
  }

  throw new Error(message);
}
